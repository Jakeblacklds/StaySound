package expo.modules.homeview

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class HomeViewModule : Module() {
    override fun definition() = ModuleDefinition {
        Name("StaySoundHomeView")
        View(HomeView::class) {
            Events("onAction")
            Prop("catalog") { view: HomeView, value: String -> view.setCatalog(value) }
            Prop("recentlyPlayed") { view: HomeView, value: String -> view.setRecentlyPlayed(value) }
            Prop("appearance") { view: HomeView, value: Map<String, String> -> view.setAppearance(value) }
            Prop("labels") { view: HomeView, value: Map<String, String> -> view.setLabels(value) }
            Prop("userName") { view: HomeView, value: String -> view.setUserName(value) }
            Prop("scanning") { view: HomeView, value: Boolean -> view.setScanning(value) }
            Prop("lightweight") { view: HomeView, value: Boolean -> view.setLightweight(value) }
            Prop("topInset") { view: HomeView, value: Double -> view.setTopInset(value) }
            Prop("bottomInset") { view: HomeView, value: Double -> view.setBottomInset(value) }
        }
    }
}
