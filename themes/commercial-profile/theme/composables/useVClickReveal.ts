import { ref, onUnmounted } from 'vue'
import { onSlideEnter, onSlideLeave } from '@slidev/client'

/**
 * Triggers a fresh chart mount after the slide transition completes.
 * The 600ms delay accounts for the 0.5s slide-left transition.
 */
export function useVClickReveal(_wrapperRef?: any) {
  const show = ref(false)

  onSlideEnter(() => {
    show.value = false
    // Wait for slide transition to finish, then mount the chart
    setTimeout(() => { show.value = true }, 600)
  })

  onSlideLeave(() => {
    show.value = false
  })

  return { show }
}
