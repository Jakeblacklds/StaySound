package expo.modules.settingsview

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class SettingsViewModule : Module() {
    override fun definition() = ModuleDefinition {
        Name("StaySoundSettingsView")
        View(SettingsView::class) {
            Events("onAction")
            Prop("snapshot") { view: SettingsView, value: String -> view.setSnapshot(value) }
            Prop("appearance") { view: SettingsView, value: Map<String, String> -> view.setAppearance(value) }
            Prop("topInset") { view: SettingsView, value: Double -> view.setTopInset(value) }
            Prop("bottomInset") { view: SettingsView, value: Double -> view.setBottomInset(value) }
        }
    }
}
