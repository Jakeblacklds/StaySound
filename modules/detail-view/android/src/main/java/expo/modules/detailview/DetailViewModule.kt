package expo.modules.detailview

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class DetailViewModule : Module() {
    override fun definition() = ModuleDefinition {
        Name("StaySoundDetailView")
        View(DetailView::class) {
            Events("onAction")
            Prop("catalog") { view: DetailView, value: String -> view.setCatalog(value) }
            Prop("selection") { view: DetailView, value: String -> view.setSelection(value) }
            Prop("artistInfo") { view: DetailView, value: Map<String, String> -> view.setArtistInfo(value) }
            Prop("appearance") { view: DetailView, value: Map<String, String> -> view.setAppearance(value) }
            Prop("labels") { view: DetailView, value: Map<String, String> -> view.setLabels(value) }
            Prop("currentTrackId") { view: DetailView, value: String -> view.setCurrentTrackId(value) }
            Prop("topInset") { view: DetailView, value: Double -> view.setTopInset(value) }
            Prop("bottomInset") { view: DetailView, value: Double -> view.setBottomInset(value) }
        }
    }
}
