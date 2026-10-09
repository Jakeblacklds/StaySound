package expo.modules.equalizerview

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class EqualizerViewModule : Module() {
    override fun definition() = ModuleDefinition {
        Name("StaySoundEqualizerView")
        View(EqualizerView::class) {
            Events("onAction")
            Prop("snapshot") { view: EqualizerView, value: String -> view.setSnapshot(value) }
            Prop("appearance") { view: EqualizerView, value: Map<String, String> -> view.setAppearance(value) }
            Prop("topInset") { view: EqualizerView, value: Double -> view.setTopInset(value) }
            Prop("bottomInset") { view: EqualizerView, value: Double -> view.setBottomInset(value) }
        }
    }
}
