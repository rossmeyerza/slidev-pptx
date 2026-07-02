<template>
  <div class="w-full h-full">
    <apexchart 
      type="bar" 
      :height="height" 
      :options="chartOptions" 
      :series="series"
    ></apexchart>
  </div>
</template>

<script setup>
import { ref } from 'vue'

const props = defineProps({
  height: { type: Number, default: 200 }
})

const series = [{
  name: 'Coca-Cola CRM',
  data: [15, 22, 35, 20, 8]
}, {
  name: 'Shoprite Baseline',
  data: [18, 25, 25, 22, 10]
}]

const chartOptions = {
  chart: {
    type: 'bar',
    toolbar: { show: false },
    animations: {
      enabled: true,
      easing: 'easeinout',
      speed: 800
    }
  },
  plotOptions: {
    bar: {
      horizontal: false,
      columnWidth: '60%',
      borderRadius: 2
    },
  },
  colors: ['#E61D2B', '#9CA3AF'],
  dataLabels: { enabled: false },
  stroke: {
    show: true,
    width: 2,
    colors: ['transparent']
  },
  xaxis: {
    categories: ['18-24', '25-29', '30-39', '40-49', '50+'],
    labels: {
      style: { colors: '#6B7280', fontSize: '9px', fontWeight: 600 }
    }
  },
  yaxis: {
    labels: {
      formatter: function (val) { return val + '%' },
      style: { colors: '#6B7280', fontSize: '9px', fontWeight: 600 }
    }
  },
  fill: { opacity: 1 },
  legend: {
    position: 'top',
    horizontalAlign: 'right',
    fontSize: '10px',
    fontWeight: 600,
    markers: { radius: 2 }
  },
  grid: {
    borderColor: '#E5E7EB',
    strokeDashArray: 4,
  }
}
</script>
