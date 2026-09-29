package expo.modules.playlistview

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class PlaylistViewModule : Module() {
    override fun definition() = ModuleDefinition {
        Name("StaySoundPlaylistView")
        View(PlaylistView::class) {
            Events("onAction")
            Prop("catalog") { view: PlaylistView, value: String -> view.setCatalog(value) }
            Prop("selection") { view: PlaylistView, value: String -> view.setSelection(value) }
            Prop("appearance") { view: PlaylistView, value: Map<String, String> -> view.setAppearance(value) }
            Prop("labels") { view: PlaylistView, value: Map<String, String> -> view.setLabels(value) }
            Prop("playback") { view: PlaylistView, value: String -> view.setPlayback(value) }
            Prop("downloads") { view: PlaylistView, value: String -> view.setDownloads(value) }
            Prop("response") { view: PlaylistView, value: String -> view.setResponse(value) }
            Prop("topInset") { view: PlaylistView, value: Double -> view.setTopInset(value) }
            Prop("bottomInset") { view: PlaylistView, value: Double -> view.setBottomInset(value) }
        }
    }
}
