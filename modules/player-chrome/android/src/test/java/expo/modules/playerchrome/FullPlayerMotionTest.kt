package expo.modules.playerchrome

import org.junit.Assert.*
import org.junit.Test

class FullPlayerMotionTest {
    @Test fun `artwork stays continuous and bounded throughout interrupted morphs`() {
        var previous=0f
        for(i in -10..110) {
            val p=FullPlayerMotion.artworkProgress(i/100f)
            assertTrue(p in 0f..1f)
            assertTrue(p>=previous)
            if(i>0 && i<=100) assertTrue(p-previous<.02f)
            previous=p
        }
        assertEquals(0f,FullPlayerMotion.artworkProgress(0f),0f)
        assertEquals(1f,FullPlayerMotion.artworkProgress(1f),0f)
    }
    @Test fun `compact screens preserve minimum cover and large screens respect width`() {
        assertEquals(218f,FullPlayerMotion.artworkSize(320f,568f,24f,24f),.01f)
        assertEquals(320f,FullPlayerMotion.artworkSize(400f,1000f,24f,24f),.01f)
        val cover=FullPlayerMotion.artworkSize(400f,840f,32f,24f)
        assertTrue(cover+42+58+414+32<=840)
    }
    @Test fun `small slow gestures cancel but directional flings complete`() {
        assertFalse(FullPlayerMotion.dismiss(80f,500f))
        assertFalse(FullPlayerMotion.expand(-70f,-400f))
        assertTrue(FullPlayerMotion.dismiss(20f,1300f))
        assertTrue(FullPlayerMotion.expand(-20f,-900f))
        assertFalse(FullPlayerMotion.dismiss(-220f,-1300f))
        assertFalse(FullPlayerMotion.expand(200f,1000f))
    }
}
