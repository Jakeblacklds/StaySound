package expo.modules.playerchrome

import android.content.Context
import android.content.res.ColorStateList
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.RippleDrawable
import android.view.Gravity
import android.view.View
import android.view.animation.PathInterpolator
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import androidx.core.graphics.ColorUtils
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import com.bumptech.glide.Glide
import com.google.android.material.bottomsheet.BottomSheetBehavior
import com.google.android.material.bottomsheet.BottomSheetDialog

/** Shared song menu for the native catalog surfaces. All motion stays on the UI thread. */
class TrackActionsSheet(
    context: Context,
    title: String,
    subtitle: String,
    artwork: String,
    fallbackArtwork: String = "",
    surface: Int,
    ink: Int,
    secondary: Int,
    accent: Int,
    closeLabel: String,
    motionEnabled: Boolean,
    actions: List<Action>,
) : BottomSheetDialog(context) {
    data class Action(val label: String, val icon: String, val hint: String = "",
                      val destructive: Boolean = false, val onSelect: () -> Unit)

    private val animateContent = motionEnabled &&
        (android.os.Build.VERSION.SDK_INT < 26 || android.animation.ValueAnimator.areAnimatorsEnabled())
    private val body = LinearLayout(context).apply { orientation = LinearLayout.VERTICAL }
    private val art = ImageView(context)
    private var selected = false
    private var pendingAction: (() -> Unit)? = null
    private fun dp(value: Int) = (value * context.resources.displayMetrics.density).toInt()
    private fun shape(color: Int, radius: Int) = GradientDrawable().apply {
        setColor(color); cornerRadius = dp(radius).toFloat()
    }

    init {
        val scroll = ScrollView(context).apply {
            isFillViewport = false; isVerticalScrollBarEnabled = false
            addView(body); clipToPadding = false
        }
        body.setPadding(dp(16), dp(10), dp(16), dp(16))
        val handle = FrameLayout(context).apply {
            importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
            addView(View(context).apply { background = shape(ColorUtils.setAlphaComponent(ink, 65), 2) },
                FrameLayout.LayoutParams(dp(32), dp(4), Gravity.CENTER))
        }
        body.addView(handle, LinearLayout.LayoutParams(-1, dp(16)))
        val header = LinearLayout(context).apply {
            gravity = Gravity.CENTER_VERTICAL; setPadding(dp(8), dp(16), 0, dp(24))
        }
        art.apply {
            scaleType = ImageView.ScaleType.CENTER_CROP; clipToOutline = true
            background = shape(ColorUtils.blendARGB(surface, accent, .12f), 12)
            importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
        }
        header.addView(art, LinearLayout.LayoutParams(dp(64), dp(64)))
        val meta = LinearLayout(context).apply { orientation = LinearLayout.VERTICAL }
        meta.addView(context.playerText(20f, 700).apply {
            setSingleLine(false); text = title; maxLines = 2; setTextColor(ink)
            ViewCompat.setAccessibilityHeading(this, true)
        })
        if (subtitle.isNotBlank()) meta.addView(context.playerText(14f, 400).apply {
            setSingleLine(false); text = subtitle; maxLines = 2; setTextColor(secondary); setPadding(0, dp(6), 0, 0)
        })
        header.addView(meta, LinearLayout.LayoutParams(0, -2, 1f).apply { leftMargin = dp(16) })
        header.addView(StayIconView(context, "close").apply {
            this.ink = secondary; motion.enabled = animateContent
            setPadding(dp(13), dp(13), dp(13), dp(13)); contentDescription = closeLabel
            importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_YES
            background = RippleDrawable(ColorStateList.valueOf(ColorUtils.setAlphaComponent(ink, 25)), null, shape(Color.WHITE, 24))
            isFocusable = true; setOnClickListener { cancel() }
        }, LinearLayout.LayoutParams(dp(48), dp(48)))
        body.addView(header)
        val destructiveInk = if (ColorUtils.calculateLuminance(surface) < .5) 0xffffb4ab.toInt() else 0xffba1a1a.toInt()
        actions.forEachIndexed { index, action ->
            if (action.destructive && actions.getOrNull(index - 1)?.destructive != true) {
                body.addView(View(context).apply { setBackgroundColor(ColorUtils.setAlphaComponent(ink, 24)) },
                    LinearLayout.LayoutParams(-1, dp(1)).apply { setMargins(dp(8), dp(12), dp(8), dp(12)) })
            }
            val primary = index == 0
            val rowInk = if (action.destructive) destructiveInk else ink
            val row = object : LinearLayout(context) {
                override fun setPressed(pressed: Boolean) {
                    super.setPressed(pressed)
                    animate().cancel()
                    if (animateContent) animate().scaleX(if (pressed) .985f else 1f)
                        .scaleY(if (pressed) .985f else 1f).setDuration(if (pressed) 100 else 180)
                        .setInterpolator(PathInterpolator(.2f, 0f, 0f, 1f)).start()
                }
            }.apply {
                gravity = Gravity.CENTER_VERTICAL; minimumHeight = dp(60)
                setPadding(dp(16), dp(12), dp(16), dp(12)); isFocusable = true
                background = RippleDrawable(ColorStateList.valueOf(ColorUtils.setAlphaComponent(accent, 30)),
                    shape(if (primary) ColorUtils.blendARGB(surface, accent, .12f) else Color.TRANSPARENT, 16), null)
            }
            row.addView(StayIconView(context, action.icon).apply {
                this.ink = if (primary) accent else rowInk; motion.enabled = animateContent
            }, LinearLayout.LayoutParams(dp(24), dp(24)).apply { rightMargin = dp(16) })
            val copy = LinearLayout(context).apply {
                orientation = LinearLayout.VERTICAL
                importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS
            }
            copy.addView(context.playerText(16f, if (primary) 600 else 500).apply {
                setSingleLine(false); text = action.label; setTextColor(rowInk)
            })
            if (action.hint.isNotBlank()) copy.addView(context.playerText(13f, 400).apply {
                setSingleLine(false); text = action.hint; setTextColor(secondary); setPadding(0, dp(4), 0, 0)
            })
            row.addView(copy, LinearLayout.LayoutParams(0, -2, 1f))
            row.contentDescription = listOf(action.label, action.hint).filter { it.isNotBlank() }.joinToString(". ")
            row.setOnClickListener {
                if (!selected) {
                    selected = true; pendingAction = action.onSelect
                    row.performHapticFeedback(android.view.HapticFeedbackConstants.KEYBOARD_TAP)
                    dismiss()
                }
            }
            body.addView(row, LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = dp(4) })
        }
        setContentView(scroll)
        behavior.maxWidth = dp(640)
        behavior.skipCollapsed = true
        dismissWithAnimation = animateContent
        ViewCompat.setOnApplyWindowInsetsListener(scroll) { view, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
            view.setPadding(bars.left, 0, bars.right, bars.bottom)
            insets
        }
        setOnShowListener {
            findViewById<FrameLayout>(com.google.android.material.R.id.design_bottom_sheet)?.apply {
                background = GradientDrawable().apply {
                    setColor(surface)
                    cornerRadii = floatArrayOf(dp(28).toFloat(), dp(28).toFloat(), dp(28).toFloat(), dp(28).toFloat(), 0f, 0f, 0f, 0f)
                }
                clipToOutline = true
            }
            behavior.state = BottomSheetBehavior.STATE_EXPANDED
            ViewCompat.requestApplyInsets(scroll)
            if (animateContent) {
                body.alpha = .4f; body.translationY = dp(16).toFloat()
                body.animate().alpha(1f).translationY(0f).setDuration(260)
                    .setInterpolator(PathInterpolator(.16f, 1f, .3f, 1f)).start()
            }
            val placeholder = context.stayIcon("music", interactive = false).apply { this.ink = secondary }
            val request = Glide.with(context.applicationContext).load(artwork.ifEmpty { null })
                .override(dp(128)).centerCrop().placeholder(placeholder).error(placeholder).dontAnimate()
            if (fallbackArtwork.isNotBlank() && fallbackArtwork != artwork) request.error(
                Glide.with(context.applicationContext).load(fallbackArtwork).override(dp(128)).centerCrop().error(placeholder).dontAnimate())
            request.into(art)
        }
        setOnDismissListener {
            body.animate().cancel()
            Glide.with(context.applicationContext).clear(art)
            val action = pendingAction; pendingAction = null
            action?.invoke()
        }
    }

    /** Detaching the owning screen must not execute a selection waiting for its exit animation. */
    fun dispose() { pendingAction = null; dismissWithAnimation = false; dismiss() }
}
