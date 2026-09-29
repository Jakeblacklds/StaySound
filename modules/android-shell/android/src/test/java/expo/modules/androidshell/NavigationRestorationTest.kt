package expo.modules.androidshell

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import androidx.activity.ComponentActivity
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

class NavigationTestActivity : ComponentActivity() {
    lateinit var navigation: NavigationModel
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        navigation = NavigationSession.attach(this)
    }
    override fun onDestroy() {
        NavigationSession.detach(this)
        super.onDestroy()
    }
}

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], manifest = Config.NONE)
class NavigationRestorationTest {
    @Test fun savedRegistryRestoresInANewActivityAndNewViewModelWithoutReplayingLaunchLink() {
        val intent = Intent(Intent.ACTION_VIEW, Uri.parse("staysound://album/launch"))
        val original = Robolectric.buildActivity(NavigationTestActivity::class.java, intent).setup()
        val holder = original.get().navigation
        holder.state.navigate(requireNotNull(Destination.parse("/tidal")))
        holder.state.navigate(requireNotNull(Destination.parse("/tidal-artist/42?source=qobuz&name=Bj%C3%B6rk")))
        holder.state.player(true)
        val expected = holder.state.snapshot()
        val saved = Bundle()
        original.pause().saveInstanceState(saved).stop().destroy()
        val recreated = Robolectric.buildActivity(NavigationTestActivity::class.java, intent).create(saved).start().resume()
        assertNotSame(holder, recreated.get().navigation)
        assertEquals(expected, recreated.get().navigation.state.snapshot())
        assertTrue(recreated.get().navigation.state.back())
        assertEquals("Björk", recreated.get().navigation.state.current.destination.arguments["name"])
        assertEquals("/tidal", recreated.get().navigation.state.activeTab)
        recreated.pause().stop().destroy()
    }
    @Test fun aNewDeepLinkOnProcessRecreationIsDeliveredAboveTheRestoredDestination() {
        val original = Robolectric.buildActivity(NavigationTestActivity::class.java,
            Intent(Intent.ACTION_VIEW, Uri.parse("staysound://album/old"))).setup()
        val saved = Bundle()
        original.pause().saveInstanceState(saved).stop().destroy()
        val next = Robolectric.buildActivity(NavigationTestActivity::class.java,
            Intent(Intent.ACTION_VIEW, Uri.parse("staysound://tidal-artist/new"))).create(saved).start().resume()
        assertEquals("new", next.get().navigation.state.current.destination.arguments["id"])
        next.get().navigation.state.back()
        assertEquals("old", next.get().navigation.state.current.destination.arguments["id"])
        next.pause().stop().destroy()
    }
    @Test fun detachAndReattachWithinTheSameActivityRetainsNavigation() {
        val activity = Robolectric.buildActivity(NavigationTestActivity::class.java).setup()
        val holder = activity.get().navigation
        holder.state.navigate(requireNotNull(Destination.parse("/library")))
        holder.state.navigate(requireNotNull(Destination.parse("/album/a")))
        NavigationSession.detach(activity.get())
        val attached = NavigationSession.attach(activity.get())
        assertSame(holder, attached)
        assertEquals("a", attached.state.current.destination.arguments["id"])
        activity.pause().stop().destroy()
    }
    @Test fun activityConfigurationRecreationPreservesTheStack() {
        val controller = Robolectric.buildActivity(NavigationTestActivity::class.java).setup()
        controller.get().navigation.state.navigate(requireNotNull(Destination.parse("/playlists")))
        controller.get().navigation.state.navigate(requireNotNull(Destination.parse("/playlist/rotation")))
        val expected = controller.get().navigation.state.snapshot()
        controller.recreate()
        assertEquals(expected, controller.get().navigation.state.snapshot())
        assertTrue(controller.get().navigation.state.back())
        assertEquals("/playlists", controller.get().navigation.state.activeTab)
        controller.pause().stop().destroy()
    }
}
