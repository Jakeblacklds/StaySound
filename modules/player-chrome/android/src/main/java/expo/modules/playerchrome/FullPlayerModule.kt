package expo.modules.playerchrome

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class FullPlayerModule : Module() {
    override fun definition() = ModuleDefinition {
        Name("StaySoundFullPlayer")
        View(FullPlayerView::class) {
            Events("onAction", "onTransition")
            Prop("model") { view: FullPlayerView, value: String -> view.setModel(value) }
            Prop("visible") { view: FullPlayerView, value: Boolean -> view.setExpanded(value) }
            Prop("layoutConfig") { view: FullPlayerView, value: Map<String, Double> -> view.setGeometry(value) }
            Prop("positionMs") { view: FullPlayerView, value: Double -> view.setPosition(value.toLong()) }
            Prop("palette") { view: FullPlayerView, value: Map<String, String> -> view.setPalette(value) }
            Prop("queue") { view: FullPlayerView, value: String -> view.setQueue(value) }
            Prop("lyrics") { view: FullPlayerView, value: String -> view.setLyrics(value) }
            Prop("backRequest") { view: FullPlayerView, value: Int -> view.handleBack(value) }
            Prop("blocked") { view: FullPlayerView, value: Boolean -> view.setBlocked(value) }
        }
    }
}
