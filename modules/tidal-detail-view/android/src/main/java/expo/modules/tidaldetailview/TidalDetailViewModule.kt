package expo.modules.tidaldetailview

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class TidalDetailViewModule : Module() {
    override fun definition() = ModuleDefinition {
        Name("StaySoundTidalDetailView")
        View(TidalDetailView::class) {
            Events("onAction")
            Prop("model") { view: TidalDetailView, value: String -> view.setModel(value) }
            Prop("appearance") { view: TidalDetailView, value: Map<String, String> -> view.setAppearance(value) }
            Prop("topInset") { view: TidalDetailView, value: Double -> view.setTopInset(value) }
            Prop("bottomInset") { view: TidalDetailView, value: Double -> view.setBottomInset(value) }
        }
    }
}
