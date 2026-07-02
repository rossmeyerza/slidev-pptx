<script setup>
import { computed } from 'vue'

const props = defineProps({
  title: String,
  subtitle: String
})
</script>

<template>
  <div class="slidev-layout cover w-full h-full flex flex-col justify-center items-start p-12 relative overflow-hidden">
    <!-- Watermark image -->
    <img src="../../public/images/cover-watermark.jpeg" class="absolute right-0 top-0 h-full w-auto object-cover pointer-events-none" style="mask-image: linear-gradient(to left, rgba(0,0,0,0.6) 0%, transparent 80%); -webkit-mask-image: linear-gradient(to left, rgba(0,0,0,0.6) 0%, transparent 80%);" />
    <div class="my-auto w-full relative z-10">
      <div class="mb-6 flex items-center space-x-4">
        <img src="../../public/coca-cola.svg" alt="Coca-Cola" class="h-16 object-contain drop-shadow-sm" />
        <div class="w-px h-10 bg-gray-300"></div>
        <img src="../../public/omnisient-logo.svg" alt="Omnisient" class="h-8 object-contain opacity-80" />
        <div class="w-px h-10 bg-gray-300"></div>
        <img src="../../public/checkers-sixty60-logo.png" alt="Checkers Sixty60" class="h-8 object-contain opacity-90" />
      </div>
      <div class="flex items-center gap-3 mb-2">
        <img src="../../public/images/cover-title.svg" alt="H1" class="h-8" />
        <h1 class="text-4xl font-extrabold leading-tight text-gray-900 tracking-tight">{{ (title || $slidev.configs.title).replace(/^H1\s*/, '') }}</h1>
      </div>
      <h2 class="text-xl font-medium text-gray-500 mb-8 max-w-3xl leading-snug">
        {{ subtitle || 'From Data to Precision-Targeted Growth' }}
      </h2>
      <slot />
    </div>
    
    <div class="absolute bottom-6 left-12 right-12 flex items-center justify-between text-gray-400 text-[0.65rem] font-medium tracking-wide z-10">
      <div class="flex items-center space-x-6">
        <img src="../../public/wpp-openx-1pd.svg" class="h-3 opacity-40" />
        <span class="text-gray-300">|</span>
        <span>Omnisient Data Clean Room</span>
        <span class="text-gray-300">|</span>
        <span>March 2026</span>
      </div>
      <img src="../../public/vml-logo.svg" class="h-3 opacity-50" />
    </div>
  </div>
</template>

<style scoped>
.cover {
  background-color: #F9FAFB;
  background-image: radial-gradient(circle at top right, rgba(230, 29, 43, 0.04) 0%, transparent 70%);
}
</style>