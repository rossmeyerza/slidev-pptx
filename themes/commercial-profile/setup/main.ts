import VueApexCharts from 'vue3-apexcharts'
import '@animxyz/core'

export default ({ app, router }: any) => {
  app.use(VueApexCharts)

  // Re-trigger stagger-in and fade-down CSS animations on slide navigation.
  // Slidev uses v-show to toggle slides, so all DOMs exist simultaneously.
  // We target only elements inside the currently VISIBLE slide wrapper.
  router.afterEach((to) => {
    setTimeout(() => {
      // The visible slide has display != none via v-show.
      // Find all SlideWrapper elements, then pick the visible one.
      const wrappers = document.querySelectorAll('#slideshow > div, #slideshow > section')
      let visibleSlide: Element | null = null
      wrappers.forEach((el) => {
        const style = window.getComputedStyle(el)
        if (style.display !== 'none') {
          visibleSlide = el
        }
      })

      if (!visibleSlide) return

      visibleSlide.querySelectorAll('.stagger-in > *').forEach((el) => {
        const htmlEl = el as HTMLElement
        htmlEl.style.animation = 'none'
        void htmlEl.offsetWidth
        htmlEl.style.animation = ''
      })
      visibleSlide.querySelectorAll('.fade-down').forEach((el) => {
        const htmlEl = el as HTMLElement
        htmlEl.style.animation = 'none'
        void htmlEl.offsetWidth
        htmlEl.style.animation = ''
      })
    }, 80)
  })
}
