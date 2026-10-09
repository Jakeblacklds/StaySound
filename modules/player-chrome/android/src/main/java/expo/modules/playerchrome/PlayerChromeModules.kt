package expo.modules.playerchrome

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class MiniPlayerModule : Module() {
    override fun definition() = ModuleDefinition {
        Name("StaySoundMiniPlayer")
        View(MiniPlayerView::class) {
            Events("onAction")
            Prop("track") { view: MiniPlayerView, value: Map<String, String> -> view.setTrack(value) }
            Prop("labels") { view: MiniPlayerView, value: Map<String, String> -> view.setLabels(value) }
            Prop("appearance") { view: MiniPlayerView, value: Map<String, String> -> view.setAppearance(value) }
            Prop("loading") { view: MiniPlayerView, value: Boolean -> view.setLoading(value) }
            Prop("paused") { view: MiniPlayerView, value: Boolean -> view.setPaused(value) }
            Prop("expansionProgress") { view: MiniPlayerView, value: Float -> view.setExpansion(value) }
            Prop("titleColor") { view: MiniPlayerView, value: Int -> view.setTitleColor(value) }
        }
    }
}

class NavigationBarModule : Module() {
    override fun definition() = ModuleDefinition {
        Name("StaySoundNavigationBar")
        View(NavigationBarView::class) {
            Events("onAction")
            Prop("items") { view: NavigationBarView, value: List<Map<String, String>> -> view.setItems(value) }
            Prop("activeKey") { view: NavigationBarView, value: String -> view.setActiveKey(value) }
            Prop("appearance") { view: NavigationBarView, value: Map<String, String> -> view.setAppearance(value) }
            Prop("surfaceColor") { view: NavigationBarView, value: Int -> view.setSurfaceColor(value) }
            Prop("shadeOpacity") { view: NavigationBarView, value: Float -> view.setShadeOpacity(value) }
            Prop("dark") { view: NavigationBarView, value: Boolean -> view.setDark(value) }
        }
    }
}
