package com.albaro.notes

import android.os.Bundle
import android.view.View
import androidx.activity.enableEdgeToEdge
import androidx.core.graphics.Insets
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)

    // The page draws under the status bar (it slides its own top bar below it with `env(safe-area-inset-top)`), but
    // the WebView does not report the navigation bar's inset on every device, and what it hides is the foot of the
    // screen. So the navigation bar is dealt with here: the window leaves room for it and the WebView never sees it.
    ViewCompat.setOnApplyWindowInsetsListener(findViewById<View>(android.R.id.content)) { view, insets ->
      val bars = insets.getInsets(WindowInsetsCompat.Type.navigationBars())
      view.setPadding(bars.left, 0, bars.right, bars.bottom)
      WindowInsetsCompat.Builder(insets)
        .setInsets(WindowInsetsCompat.Type.navigationBars(), Insets.NONE)
        .build()
    }
  }
}
