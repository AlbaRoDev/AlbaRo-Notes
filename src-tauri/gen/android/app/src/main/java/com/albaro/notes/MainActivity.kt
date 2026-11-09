package com.albaro.notes

import android.app.Activity
import android.os.Bundle
import android.view.View
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import androidx.core.graphics.Insets
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat

/**
 * The page tells the window what colour it is (`src/lib/system-bars.ts`): the system's own dark mode is not the
 * app's (the user can pick the opposite theme), so without this the strip under the navigation buttons and the
 * status bar's icons would be the wrong way round. It only changes colours; nothing can be read through it.
 */
class SystemBars(private val activity: Activity) {
  @JavascriptInterface
  fun set(rgb: Int, dark: Boolean) {
    activity.runOnUiThread {
      val window = activity.window
      window.decorView.setBackgroundColor(0xFF000000.toInt() or (rgb and 0xFFFFFF))
      val controller = WindowCompat.getInsetsController(window, window.decorView)
      controller.isAppearanceLightStatusBars = !dark
      controller.isAppearanceLightNavigationBars = !dark
    }
  }
}

class MainActivity : TauriActivity() {
  override fun onWebViewCreate(webView: WebView) {
    webView.addJavascriptInterface(SystemBars(this), "AlbaroNative")
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)

    // The page draws under the status bar (it slides its own top bar below it with `env(safe-area-inset-top)`), but
    // the WebView does not report the navigation bar's inset on every device, and what it hides is the foot of the
    // screen. So the navigation bar is dealt with here: the window leaves room for it and the WebView never sees it.
    // The on-screen keyboard is the same story: with the window edge to edge it would cover the page instead of
    // shrinking it, so the window leaves room for it too and the page (`dvh`, the bar that steps aside) follows.
    ViewCompat.setOnApplyWindowInsetsListener(findViewById<View>(android.R.id.content)) { view, insets ->
      val bars = insets.getInsets(WindowInsetsCompat.Type.navigationBars())
      val keyboard = insets.getInsets(WindowInsetsCompat.Type.ime())
      view.setPadding(bars.left, 0, bars.right, maxOf(bars.bottom, keyboard.bottom))
      WindowInsetsCompat.Builder(insets)
        .setInsets(WindowInsetsCompat.Type.navigationBars(), Insets.NONE)
        .setInsets(WindowInsetsCompat.Type.ime(), Insets.NONE)
        .build()
    }
  }
}
