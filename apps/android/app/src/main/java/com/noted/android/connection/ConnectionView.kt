package com.noted.android.connection

import android.content.Context
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.text.InputType
import android.view.Gravity
import android.view.inputmethod.EditorInfo
import android.widget.Button
import android.widget.EditText
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import com.noted.android.R

class ConnectionView(context: Context, current: String?, connect: (String) -> Unit) : LinearLayout(context) {
    init {
        orientation = VERTICAL
        gravity = Gravity.CENTER_VERTICAL
        setPadding(dp(28), dp(32), dp(28), dp(32))
        setBackgroundColor(Color.rgb(31, 31, 31))

        addView(ImageView(context).apply {
            setImageResource(R.drawable.ic_brand)
            contentDescription = "Noted"
        }, LayoutParams(dp(72), dp(72)).apply { bottomMargin = dp(24) })
        addView(text("Your notes, wherever you are.", 26f, Color.rgb(238, 238, 238)).apply {
            setTypeface(typeface, Typeface.BOLD)
        })
        addView(text("Connect to your Noted server, then sign in with your login and password.", 15f, Color.rgb(172, 172, 172)), LayoutParams(-1, -2).apply {
            topMargin = dp(12)
            bottomMargin = dp(32)
        })
        addView(text("Server address", 13f, Color.LTGRAY))
        val address = EditText(context).apply {
            setSingleLine()
            hint = "notes.yourdomain.com"
            setText(current ?: "")
            textSize = 16f
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI
            imeOptions = EditorInfo.IME_ACTION_GO
            setTextColor(Color.WHITE)
            setHintTextColor(Color.GRAY)
            setPadding(dp(14), dp(12), dp(14), dp(12))
            background = GradientDrawable().apply {
                setColor(Color.rgb(40, 40, 40))
                cornerRadius = dp(6).toFloat()
                setStroke(dp(1), Color.rgb(65, 65, 65))
            }
        }
        addView(address, LayoutParams(-1, -2).apply { topMargin = dp(8) })
        val error = text("", 13f, Color.rgb(223, 157, 150))
        addView(error, LayoutParams(-1, -2).apply { topMargin = dp(8) })
        val submit = {
            runCatching { ServerAddress.normalize(address.text.toString()) }
                .onSuccess(connect)
                .onFailure { error.text = it.message ?: "Check your server address." }
        }
        addView(Button(context).apply {
            text = "Connect"
            isAllCaps = false
            textSize = 15f
            setTextColor(Color.rgb(31, 31, 31))
            backgroundTintList = android.content.res.ColorStateList.valueOf(Color.rgb(226, 193, 90))
            setOnClickListener { submit() }
        }, LayoutParams(-1, dp(52)).apply { topMargin = dp(12) })
        address.setOnEditorActionListener { _, action, _ ->
            if (action == EditorInfo.IME_ACTION_GO) { submit(); true } else false
        }
    }

    private fun text(value: String, size: Float, color: Int) = TextView(context).apply {
        text = value
        textSize = size
        setTextColor(color)
        setLineSpacing(dp(3).toFloat(), 1f)
    }

    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()
}
