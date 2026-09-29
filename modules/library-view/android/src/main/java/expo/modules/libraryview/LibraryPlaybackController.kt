package expo.modules.libraryview

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.ServiceConnection
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import com.doublesymmetry.trackplayer.model.Track
import com.doublesymmetry.trackplayer.service.MusicService
import expo.modules.kotlin.Promise
import java.util.concurrent.Executors
import java.util.concurrent.Future

/** Uses the existing foreground service, ExoPlayer and MediaSession, never a second player. */
internal class LibraryPlaybackController(
    private val context: Context,
    private val event: (String, Map<String, Any>) -> Unit,
) : ServiceConnection {
    private val main = Handler(Looper.getMainLooper())
    private val worker = Executors.newSingleThreadExecutor()
    private var service: MusicService? = null
    private var bound = false
    private var generation = 0L
    private var work: Future<*>? = null
    private var pending: (() -> Unit)? = null
    private var pendingPromise: Promise? = null
    private var latestRequestedAt = 0L
    private var closed = false

    fun connect() {
        if (bound || closed) return
        bound = context.bindService(Intent(context, MusicService::class.java), this, Context.BIND_AUTO_CREATE)
        check(bound) { "Could not connect to the playback service" }
    }

    override fun onServiceConnected(name: ComponentName, binder: IBinder) {
        if (closed) return
        service = (binder as MusicService.MusicBinder).service
        pending?.also { pending = null; it() }
    }
    override fun onServiceDisconnected(name: ComponentName) {
        service = null
        cancelPending()
    }
    override fun onBindingDied(name: ComponentName) {
        if (bound) context.unbindService(this)
        bound = false
        service = null
        cancelPending()
    }
    override fun onNullBinding(name: ComponentName) = onBindingDied(name)

    fun cancelPending() {
        generation++
        work?.cancel(true)
        pending = null
        // Superseding a request is normal; never let its rejection overwrite a newer song.
        pendingPromise?.resolve(null)
        pendingPromise = null
        main.removeCallbacksAndMessages(null)
    }

    fun play(origin: String, requestedAt: Long = System.currentTimeMillis(), promise: Promise? = null,
             plan: () -> PlaybackPlan) {
        if (requestedAt < latestRequestedAt || closed) { promise?.resolve(null); return }
        latestRequestedAt = requestedAt
        cancelPending()
        val version = generation
        val started = SystemClock.elapsedRealtime()
        pendingPromise = promise
        val action = action@{
            val activeService = service ?: return@action
            try {
                activeService.prepareNativeLibraryPlayback()
                val ratingType = activeService.ratingType
                work = worker.submit {
                    try {
                        val selection = plan()
                        val tracks = selection.queue.map { item ->
                            if (Thread.currentThread().isInterrupted) throw InterruptedException()
                            Track(context, item.toBundle(), ratingType)
                        }
                        main.post {
                            if (version != generation || closed) return@post
                            try {
                                activeService.playNativeLibraryQueue(tracks, selection.index, started)
                                Log.i("LibraryPlayback", "native_command_ms=${SystemClock.elapsedRealtime() - started} queue=${tracks.size}")
                                if (origin == "library") event("onPlaybackStarted", mapOf(
                                    "trackId" to selection.queue[selection.index].id,
                                    "queueIds" to selection.queue.map { it.id },
                                    "linearIds" to selection.linear.map { it.id },
                                    "index" to selection.index,
                                ))
                                pendingPromise?.resolve(null)
                                pendingPromise = null
                            } catch (error: Exception) { fail(version, origin, error) }
                        }
                    } catch (_: InterruptedException) {
                    } catch (error: Exception) { main.post { fail(version, origin, error) } }
                }
            } catch (error: Exception) { fail(version, origin, error) }
        }
        pending = action
        try {
            connect()
            if (service != null) { pending = null; action() }
            main.postDelayed({
                if (version == generation && pending != null) fail(version, origin, IllegalStateException("Playback service connection timed out"))
            }, 5000)
        } catch (error: Exception) { fail(version, origin, error) }
    }

    private fun fail(version: Long, origin: String, error: Exception) {
        if (version != generation || closed) return
        pending = null
        Log.e("LibraryPlayback", "Native playback failed", error)
        pendingPromise?.reject("native_playback_failed", error.message, error)
        pendingPromise = null
        if (origin == "library") event("onPlaybackFailed", mapOf("message" to (error.message ?: "Playback failed")))
    }

    fun close() {
        closed = true
        cancelPending()
        worker.shutdownNow()
        if (bound) context.unbindService(this)
        bound = false
        service = null
    }

    private fun PlaybackTrack.toBundle() = Bundle().apply {
        putString("id", id)
        putString("mediaId", id)
        // Media3 reads content:// directly using the app's media permission. There is
        // no stat/query/copy for every queued file and no JS round-trip per song.
        putString("url", if (uri.startsWith("/")) Uri.fromFile(java.io.File(uri)).toString() else uri)
        putString("title", title)
        putString("artist", artist)
        putString("album", album)
        if (artwork.isNotBlank() && !artwork.startsWith("data:")) putString("artwork", artwork)
        if (duration > 0) putDouble("duration", duration / 1000.0)
        putString("format", format)
        putInt("sampleRate", sampleRate)
        putInt("bitDepth", bitDepth)
        putString("quality", quality)
        val normalizedFormat = format.lowercase()
        when {
            uri.contains(".m3u8", true) || normalizedFormat == "hls" -> putString("type", "hls")
            uri.contains(".mpd", true) || normalizedFormat in setOf("dash", "mpd") -> putString("type", "dash")
        }
    }

    companion object {
        var instance: LibraryPlaybackController? = null
            private set
        fun install(context: Context, event: (String, Map<String, Any>) -> Unit) {
            instance?.close()
            instance = LibraryPlaybackController(context.applicationContext, event)
        }
        fun uninstall() { instance?.close(); instance = null }
    }
}
