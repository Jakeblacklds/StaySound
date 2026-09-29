package expo.modules.androidshell

import android.app.Dialog
import android.content.Context
import android.view.Gravity
import android.view.ViewGroup
import android.widget.*
import androidx.appcompat.view.ContextThemeWrapper
import com.bumptech.glide.Glide
import com.google.android.material.bottomsheet.BottomSheetDialog
import com.google.android.material.dialog.MaterialAlertDialogBuilder
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import org.json.JSONObject

class OverlayHostView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
    override val shouldUseAndroidLayout = true
    private val onAction by EventDispatcher()
    private val policy = OverlayPolicy()
    private val ui = ContextThemeWrapper(context, com.google.android.material.R.style.Theme_Material3_DayNight_NoActionBar)
    private val style = ShellStyle(ui)
    private val frame = FrameLayout(ui)
    private var snapshot = JSONObject()
    private var dialog: Dialog? = null
    private var dialogKey = ""
    private var toast: ShellToast? = null
    private var snackKey = ""

    init { addView(frame, LayoutParams(-1, -1)) }
    fun setSnapshot(raw: String) {
        snapshot = JSONObject(raw)
        style.colors = snapshot.optJSONObject("colors") ?: JSONObject()
        fun overlay(key: String, kind: String): Overlay? = snapshot.optJSONObject(key)?.let {
            Overlay(kind, it.getString("id"), it.optJSONArray("actions")?.length() ?: 0)
        }
        val queue = snapshot.optJSONArray("notifications")
        policy.update(overlay("confirmation", "confirmation"), overlay("sheet", "sheet"),
            (0 until (queue?.length() ?: 0)).map { Overlay("notification", queue!!.getJSONObject(it).getString("id")) })
        render()
    }
    private fun send(action: ShellAction?) {
        action ?: return
        onAction(mapOf("kind" to action.kind, "id" to action.id, "action" to action.action, "index" to action.index))
    }
    private fun disposeDialog() {
        dialog?.setOnCancelListener(null)
        dialog?.dismiss(); dialog = null; dialogKey = ""
    }
    private fun disposeSnack() {
        // Invalidate the callback before programmatic replacement/pause/unmount.
        snackKey = ""; toast?.dispose(); toast = null
    }
    private fun render() {
        if (!isAttachedToWindow || windowVisibility != VISIBLE) return
        val item = policy.dialog()
        val data = snapshot.optJSONObject(if (item?.kind == "confirmation") "confirmation" else "sheet")
        val key = if (item == null) "" else "${item.kind}:${item.id}:${data}:${style.colors}"
        if (key != dialogKey) {
            disposeDialog()
            if (item != null && data != null && !policy.pending(item)) {
                disposeSnack()
                dialogKey = key
                dialog = if (item.kind == "confirmation") confirmation(item, data) else sheet(item, data)
                dialog?.setOnCancelListener { send(policy.back(item)) }
                dialog?.show()
                (dialog as? androidx.appcompat.app.AlertDialog)?.let { alert ->
                    alert.getButton(-1)?.setTextColor(if (data.optBoolean("isDestructive")) style.error else style.primary)
                    alert.getButton(-2)?.setTextColor(style.primary)
                }
            }
        }
        val notice = policy.notification()
        val queue = snapshot.optJSONArray("notifications")
        if (notice == null || policy.pending(notice)) { disposeSnack(); return }
        if (snackKey == notice.id) return
        disposeSnack()
        val notification = queue?.optJSONObject(0) ?: return
        snackKey = notice.id
        val card = ShellToast(ui, style, notification.optString("message"), notification.optString("type")) {
            if (snackKey == notice.id) send(policy.action(notice, "dismiss"))
        }
        val width = resources.displayMetrics.widthPixels
        frame.addView(card, FrameLayout.LayoutParams(
            if (width > style.dp(600)) style.dp(560) else -1, -2, Gravity.BOTTOM or Gravity.CENTER_HORIZONTAL,
        ).apply {
            bottomMargin = style.dp(snapshot.optInt("bottomInset") + 100)
            leftMargin = style.dp(16 + snapshot.optInt("leftInset"))
            rightMargin = style.dp(16 + snapshot.optInt("rightInset"))
        })
        toast = card; card.show()
    }
    private fun confirmation(item: Overlay, data: JSONObject): Dialog = MaterialAlertDialogBuilder(ui)
        .setBackground(android.graphics.drawable.GradientDrawable().apply {
            setColor(style.surface); cornerRadius = style.dp(28).toFloat()
        })
        .setTitle(data.optString("title"))
        .setMessage(data.optString("message"))
        .setNegativeButton(data.optString("cancelLabel", "Cancelar")) { _, _ -> send(policy.action(item, "dismiss")) }
        .setPositiveButton(data.optString("confirmLabel", "Confirmar")) { _, _ -> send(policy.action(item, "confirm")) }
        .create().apply {
            setOnShowListener {
                findViewById<TextView>(android.R.id.message)?.setTextColor(style.text)
                findViewById<TextView>(androidx.appcompat.R.id.alertTitle)?.setTextColor(style.text)
            }
        }

    private fun sheet(item: Overlay, data: JSONObject): Dialog {
        val result = BottomSheetDialog(ui)
        val content = LinearLayout(ui).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(style.surface)
            setPadding(style.dp(20), style.dp(16), style.dp(20), style.dp(24))
        }
        val header = LinearLayout(ui).apply { gravity = Gravity.CENTER_VERTICAL }
        val artwork = data.optString("artwork")
        if (artwork.isNotEmpty()) {
            val image = ImageView(ui).apply { importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_NO; scaleType = ImageView.ScaleType.CENTER_CROP }
            header.addView(image, LinearLayout.LayoutParams(style.dp(56), style.dp(56)).apply { marginEnd = style.dp(12) })
            Glide.with(image).load(artwork).into(image)
        }
        val meta = LinearLayout(ui).apply { orientation = LinearLayout.VERTICAL }
        meta.addView(style.text(data.optString("title"), 22f))
        data.optString("subtitle").takeIf { it.isNotEmpty() }?.let { meta.addView(style.text(it, 14f).apply { setTextColor(style.secondary) }) }
        header.addView(meta, LinearLayout.LayoutParams(0, -2, 1f))
        content.addView(header)
        val actions = data.optJSONArray("actions")
        for (i in 0 until (actions?.length() ?: 0)) {
            val action = actions!!.getJSONObject(i)
            content.addView(style.button(action.optString("label"), action.optBoolean("destructive")) {
                send(policy.action(item, "select", i)); result.dismiss()
            }.apply { gravity = Gravity.START or Gravity.CENTER_VERTICAL }, LinearLayout.LayoutParams(-1, -2))
        }
        content.addView(style.button("Cerrar") { send(policy.action(item, "dismiss")); result.dismiss() })
        val scroll = ScrollView(ui).apply { addView(content) }
        result.setContentView(scroll)
        result.setOnShowListener {
            result.behavior.maxWidth = style.dp(640)
            result.behavior.maxHeight = (resources.displayMetrics.heightPixels * .85f).toInt()
            result.behavior.state = com.google.android.material.bottomsheet.BottomSheetBehavior.STATE_EXPANDED
        }
        return result
    }
    override fun onWindowVisibilityChanged(visibility: Int) {
        super.onWindowVisibilityChanged(visibility)
        if (visibility == VISIBLE) render() else { disposeDialog(); disposeSnack() }
    }
    override fun onAttachedToWindow() { super.onAttachedToWindow(); render() }
    override fun onDetachedFromWindow() { disposeDialog(); disposeSnack(); super.onDetachedFromWindow() }
}
