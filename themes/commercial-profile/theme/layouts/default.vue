<script setup>
import { computed } from 'vue'
</script>

<template>
  <div class="slidev-layout w-full h-full p-8 flex flex-col">
    <!-- Header -->
    <div class="w-full flex items-center justify-between border-b border-gray-200 pb-2 mb-4">
      <div class="flex items-center space-x-2">
        <img src="../../public/coca-cola.svg" class="h-3 opacity-90" />
        <div class="w-px h-3 bg-gray-300"></div>
        <img src="../../public/omnisient-logo.svg" class="h-3 opacity-70" />
        <div class="w-px h-3 bg-gray-300"></div>
        <img src="../../public/checkers-sixty60-logo.png" class="h-3 opacity-80" />
        <div class="w-px h-3 bg-gray-300"></div>
        <div class="text-[8px] font-bold uppercase tracking-[0.1em] text-gray-500 mt-[1px]">
          Clean Room Segments
        </div>
      </div>
      <div class="text-[9px] font-medium text-gray-400">
        H1 2026
      </div>
    </div>
    
    <!-- Main Content Slot -->
    <div class="flex-1 w-full flex flex-col">
      <slot />
    </div>
    
    <!-- Footer -->
    <div class="absolute bottom-3 left-8">
      <img src="../../public/wpp-openx-1pd.svg" class="h-3 opacity-40" />
    </div>
    <div class="absolute bottom-3 right-8 flex items-center gap-2 text-[9px] font-medium text-gray-400">
      <img src="../../public/vml-logo.svg" class="h-3 opacity-50" />
      {{ $slidev.nav.currentPage }}
    </div>
  </div>
</template>

<style scoped>
.slidev-layout {
  background-color: #FFFFFF;
  color: #111827;
}
</style>