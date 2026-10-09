package expo.modules.searchview

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class SearchViewModule : Module() {
    override fun definition() = ModuleDefinition {
        Name("StaySoundSearchView")
        View(SearchView::class) {
            Events("onAction")
            Prop("result") { view: SearchView, value: String -> view.setResult(value) }
            Prop("recommendations") { view: SearchView, value: String -> view.setRecommendations(value) }
            Prop("transfers") { view: SearchView, value: String -> view.setTransfers(value) }
            Prop("settings") { view: SearchView, value: String -> view.setSettings(value) }
            Prop("credentials") { view: SearchView, value: Map<String, String> -> view.setCredentials(value) }
            Prop("recentSearches") { view: SearchView, value: List<String> -> view.setRecentSearches(value) }
            Prop("appearance") { view: SearchView, value: Map<String, String> -> view.setAppearance(value) }
            Prop("topInset") { view: SearchView, value: Double -> view.setTopInset(value) }
            Prop("bottomInset") { view: SearchView, value: Double -> view.setBottomInset(value) }
            Prop("authRequest") { view: SearchView, value: Int -> view.requestAuth(value) }
        }
    }
}
