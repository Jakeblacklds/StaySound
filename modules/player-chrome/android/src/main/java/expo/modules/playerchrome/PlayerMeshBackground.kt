package expo.modules.playerchrome

import android.content.Context
import android.graphics.SurfaceTexture
import android.opengl.EGL14
import android.opengl.GLES20
import android.os.Handler
import android.os.HandlerThread
import android.view.Surface
import android.view.TextureView
import java.nio.ByteBuffer
import java.nio.ByteOrder

/** GLES port of PsychedelicBackground's existing SkSL, for Android 7–12. */
internal class PlayerMeshBackground(context: Context) : TextureView(context), TextureView.SurfaceTextureListener {
    @Volatile private var enabled = false
    @Volatile private var playing = false
    @Volatile private var colors = floatArrayOf(.07f,.05f,.09f,.6f,.3f,.8f,.2f,.5f,.7f,.9f,.5f,.3f)
    @Volatile private var viewportWidth = 1
    @Volatile private var viewportHeight = 1
    @Volatile private var worker: HandlerThread? = null
    private var handler: Handler? = null
    @Volatile private var generation = 0
    private var surface: SurfaceTexture? = null
    init { isOpaque=false; surfaceTextureListener=this; importantForAccessibility=IMPORTANT_FOR_ACCESSIBILITY_NO }
    fun state(enabled: Boolean, playing: Boolean) {
        this.playing=playing
        if(this.enabled==enabled) return
        this.enabled=enabled
        if(enabled) start() else stop()
    }
    fun palette(background: Int, primary: Int, secondary: Int, accent: Int) {
        colors=intArrayOf(background,primary,secondary,accent).flatMap { listOf(android.graphics.Color.red(it)/255f,android.graphics.Color.green(it)/255f,android.graphics.Color.blue(it)/255f) }.toFloatArray()
    }
    override fun onSurfaceTextureAvailable(texture: SurfaceTexture, width: Int, height: Int) { surface=texture; viewportWidth=width;viewportHeight=height;start() }
    override fun onSurfaceTextureSizeChanged(texture: SurfaceTexture, width: Int, height: Int) { viewportWidth=width;viewportHeight=height }
    override fun onSurfaceTextureUpdated(texture: SurfaceTexture) {}
    override fun onSurfaceTextureDestroyed(texture: SurfaceTexture): Boolean { stop();surface=null;return true }
    private fun stop() { generation++;worker?.quitSafely() }
    private fun start() {
        val texture=surface ?: return
        if(!enabled || worker!=null || !isAttachedToWindow) return
        val token=generation
        val thread=HandlerThread("PlayerMesh");worker=thread;thread.start()
        val queue=Handler(thread.looper);handler=queue
        queue.post {
            val display=EGL14.eglGetDisplay(EGL14.EGL_DEFAULT_DISPLAY)
            var eglContext=EGL14.EGL_NO_CONTEXT;var eglSurface=EGL14.EGL_NO_SURFACE
            var nativeSurface: Surface?=null
            try {
                val version=IntArray(2);check(EGL14.eglInitialize(display,version,0,version,1))
                val configs=arrayOfNulls<android.opengl.EGLConfig>(1);val count=IntArray(1)
                check(EGL14.eglChooseConfig(display,intArrayOf(EGL14.EGL_RENDERABLE_TYPE,EGL14.EGL_OPENGL_ES2_BIT,EGL14.EGL_RED_SIZE,8,EGL14.EGL_GREEN_SIZE,8,EGL14.EGL_BLUE_SIZE,8,EGL14.EGL_ALPHA_SIZE,8,EGL14.EGL_SURFACE_TYPE,EGL14.EGL_WINDOW_BIT,EGL14.EGL_NONE),0,configs,0,1,count,0))
                eglContext=EGL14.eglCreateContext(display,configs[0],EGL14.EGL_NO_CONTEXT,intArrayOf(EGL14.EGL_CONTEXT_CLIENT_VERSION,2,EGL14.EGL_NONE),0)
                nativeSurface=Surface(texture)
                eglSurface=EGL14.eglCreateWindowSurface(display,configs[0],nativeSurface,intArrayOf(EGL14.EGL_NONE),0)
                check(EGL14.eglMakeCurrent(display,eglSurface,eglSurface,eglContext))
                fun shader(type:Int,source:String):Int {
                    val id=GLES20.glCreateShader(type);GLES20.glShaderSource(id,source);GLES20.glCompileShader(id)
                    val status=IntArray(1);GLES20.glGetShaderiv(id,GLES20.GL_COMPILE_STATUS,status,0);check(status[0]!=0) { GLES20.glGetShaderInfoLog(id) };return id
                }
                val vertex=shader(GLES20.GL_VERTEX_SHADER,"attribute vec2 position; void main(){gl_Position=vec4(position,0.,1.);}")
                val fragment=shader(GLES20.GL_FRAGMENT_SHADER,FRAGMENT)
                val program=GLES20.glCreateProgram();GLES20.glAttachShader(program,vertex);GLES20.glAttachShader(program,fragment);GLES20.glLinkProgram(program);GLES20.glUseProgram(program)
                GLES20.glDeleteShader(vertex);GLES20.glDeleteShader(fragment)
                val vertices=ByteBuffer.allocateDirect(32).order(ByteOrder.nativeOrder()).asFloatBuffer().apply { put(floatArrayOf(-1f,-1f,1f,-1f,-1f,1f,1f,1f));position(0) }
                val pos=GLES20.glGetAttribLocation(program,"position");GLES20.glEnableVertexAttribArray(pos);GLES20.glVertexAttribPointer(pos,2,GLES20.GL_FLOAT,false,0,vertices)
                val resolution=GLES20.glGetUniformLocation(program,"resolution");val time=GLES20.glGetUniformLocation(program,"time");val intensity=GLES20.glGetUniformLocation(program,"intensity")
                val palette=listOf("cBg","cA","cB","cC").map { GLES20.glGetUniformLocation(program,it) }
                EGL14.eglSwapInterval(display,1)
                val started=System.nanoTime();var last=started;var energy=if(playing)1f else .35f
                // eglSwapBuffers paces this dedicated renderer to vsync. UI/layout never wait for it.
                while(enabled && generation==token && worker===thread && !thread.isInterrupted) {
                    val now=System.nanoTime();val delta=(now-last)/1_000_000f;last=now
                    energy+=((if(playing)1f else .35f) - energy)*minOf(1f,delta/900f)
                    GLES20.glViewport(0,0,viewportWidth,viewportHeight)
                    GLES20.glUniform2f(resolution,viewportWidth.toFloat(),viewportHeight.toFloat())
                    GLES20.glUniform1f(time,(now-started)/1_000_000_000f);GLES20.glUniform1f(intensity,energy)
                    val snapshot=colors;palette.forEachIndexed { i,id -> GLES20.glUniform3fv(id,1,snapshot,i*3) }
                    GLES20.glDrawArrays(GLES20.GL_TRIANGLE_STRIP,0,4)
                    if(!EGL14.eglSwapBuffers(display,eglSurface)) break
                    if(android.os.Build.VERSION.SDK_INT>=26 && !android.animation.ValueAnimator.areAnimatorsEnabled()) break
                }
                GLES20.glDeleteProgram(program)
            } catch (error: Exception) { android.util.Log.w("PlayerMesh","Unable to render album mesh",error) }
            finally {
                EGL14.eglMakeCurrent(display,EGL14.EGL_NO_SURFACE,EGL14.EGL_NO_SURFACE,EGL14.EGL_NO_CONTEXT)
                if(eglSurface!=EGL14.EGL_NO_SURFACE) EGL14.eglDestroySurface(display,eglSurface)
                if(eglContext!=EGL14.EGL_NO_CONTEXT) EGL14.eglDestroyContext(display,eglContext)
                EGL14.eglReleaseThread();EGL14.eglTerminate(display);nativeSurface?.release()
                thread.quitSafely()
                Handler(android.os.Looper.getMainLooper()).post {
                    if(worker===thread) { worker=null;handler=null; if(enabled && generation!=token) start() }
                }
            }
        }
    }
    override fun onAttachedToWindow() { super.onAttachedToWindow();start() }
    override fun onDetachedFromWindow() { stop();super.onDetachedFromWindow() }
    companion object {
        private const val FRAGMENT = """
            precision highp float;
            uniform vec2 resolution;
            uniform float time, intensity;
            uniform vec3 cBg,cA,cB,cC;
            void main() {
                float aspect=resolution.x/resolution.y;
                vec2 uv=vec2(gl_FragCoord.x/resolution.x*aspect,1.-gl_FragCoord.y/resolution.y);
                float t=time*(.05+.05*intensity);
                vec2 p0=vec2((.26+.16*sin(t*.70))*aspect,.30+.16*cos(t*.90));
                vec2 p1=vec2((.76+.15*cos(t*.62))*aspect,.28+.17*sin(t*.83));
                vec2 p2=vec2((.30+.18*sin(t*.54+1.5))*aspect,.76+.14*cos(t*.71+2.));
                vec2 p3=vec2((.74+.16*cos(t*.85+.5))*aspect,.74+.16*sin(t*.66+1.));
                float w0=exp(-dot(uv-p0,uv-p0)/.26),w1=exp(-dot(uv-p1,uv-p1)/.26);
                float w2=exp(-dot(uv-p2,uv-p2)/.26),w3=exp(-dot(uv-p3,uv-p3)/.26);
                gl_FragColor=vec4((cA*w0+cC*w1+cB*w2+cA*w3+cBg*.22)/(w0+w1+w2+w3+.22),1.);
            }
        """
    }
}
