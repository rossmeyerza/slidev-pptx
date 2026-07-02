import { ref } from 'vue'
import { onSlideEnter, onSlideLeave } from '@slidev/client'

/**
 * Keeps the chart always mounted to avoid layout shift.
 * On re-enter, destroys and re-inits the chart to get the full draw animation.
 */
export function useChartReveal<T>(realSeries: T, zeroSeries: T, delay = 100) {
  const series = ref<T>(JSON.parse(JSON.stringify(realSeries)) as any)
  const chartRef = ref<any>(null)
  let hasLeft = false

  onSlideLeave(() => {
    hasLeft = true
  })

  onSlideEnter(() => {
    if (!hasLeft) {
      // First time entering - chart already has real data
      return
    }
    // Re-entering: refresh the chart to replay the mount animation
    setTimeout(() => {
      if (chartRef.value?.refresh) {
        chartRef.value.refresh()
      }
    }, delay)
  })

  return { series, chartRef }
}
