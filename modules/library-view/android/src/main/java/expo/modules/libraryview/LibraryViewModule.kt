package expo.modules.libraryview

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.Promise
import expo.modules.kotlin.functions.Queues
import org.json.JSONArray

class LibraryViewModule : Module() {
    override fun definition() = ModuleDefinition {
        Name("StaySoundLibraryView")
        Events("onPlaybackStarted", "onPlaybackFailed")
        OnCreate {
            appContext.reactContext?.let { context ->
                LibraryPlaybackController.install(context) { name, payload -> sendEvent(name, payload) }
            }
        }
        OnDestroy { LibraryPlaybackController.uninstall() }
        AsyncFunction("playQueue") { json: String, startIndex: Int, requestedAt: Double, promise: Promise ->
            val controller = LibraryPlaybackController.instance
            if (controller == null) promise.reject("native_playback_unavailable", "Playback module unavailable", null)
            else controller.play("external", requestedAt.toLong(), promise) {
                val items = JSONArray(json)
                val tracks = (0 until items.length()).map { PlaybackTrack.parse(items.getJSONObject(it)) }
                val selected = tracks.getOrNull(startIndex) ?: error("Invalid playback index")
                val playable = tracks.filter { it.playable }
                val index = playable.indexOfFirst { it.id == selected.id }
                require(index >= 0) { "Selected song is not playable" }
                PlaybackPlan(playable, index, playable)
            }
        }.runOnQueue(Queues.MAIN)
        AsyncFunction("cancelPendingPlayback") { LibraryPlaybackController.instance?.cancelPending() }.runOnQueue(Queues.MAIN)
        View(LibraryView::class) {
            Events("onAction")
            Prop("catalog") { view: LibraryView, value: String -> view.setCatalog(value) }
            Prop("appearance") { view: LibraryView, value: Map<String, String> -> view.setAppearance(value) }
            Prop("labels") { view: LibraryView, value: Map<String, String> -> view.setLabels(value) }
            Prop("currentTrackId") { view: LibraryView, value: String? -> view.setCurrentTrack(value.orEmpty()) }
            Prop("scanning") { view: LibraryView, value: Boolean -> view.setScanning(value) }
            Prop("topInset") { view: LibraryView, value: Double -> view.setTopInset(value) }
            Prop("bottomInset") { view: LibraryView, value: Double -> view.setBottomInset(value) }
            Prop("playbackOptions") { view: LibraryView, value: Map<String, Any> -> view.setPlaybackOptions(value) }
        }
    }
}
