<script setup>
import { ref } from 'vue'
import { useChartReveal } from '../composables/useChartReveal'

const props = defineProps({
  height: { type: Number, default: 220 }
})

const realData = [
  { name: 'Direct (Coke 1PD)', data: [24055, 17430] },
  { name: 'Indirect (Shoprite)', data: [474725, 437819] }
]
const zeroData = [
  { name: 'Direct (Coke 1PD)', data: [0, 0] },
  { name: 'Indirect (Shoprite)', data: [0, 0] }
]
const { series, chartRef } = useChartReveal(realData, zeroData)

const chartOptions = ref({
  chart: {
    type: 'bar',
    stacked: false,
    animations: {
      enabled: true,
      easing: 'easeinout',
      speed: 1000,
      animateGradually: { enabled: true, delay: 200 }
    },
    toolbar: { show: false }
  },
  plotOptions: {
    bar: {
      horizontal: false,
      columnWidth: '55%',
      borderRadius: 4,
      dataLabels: { position: 'top' }
    }
  },
  colors: ['#E61D2B', '#2E7D32'],
  dataLabels: {
    enabled: true,
    formatter: (val) => {
      if (val >= 1000) return Math.round(val / 1000) + 'K'
      return val.toString()
    },
    style: {
      fontSize: '10px',
      fontFamily: 'TCCC-UnityText, Inter, sans-serif',
      fontWeight: 700,
      colors: ['#111827']
    },
    offsetY: -18
  },
  xaxis: {
    categories: ['Cappy Lemonade', 'Schweppes'],
    labels: {
      style: {
        fontSize: '12px',
        fontFamily: 'TCCC-UnityHeadline, Inter, sans-serif',
        fontWeight: 700
      }
    }
  },
  yaxis: {
    labels: {
      formatter: (val) => {
        if (val >= 1000) return Math.round(val / 1000) + 'K'
        return val.toString()
      },
      style: {
        fontSize: '10px',
        fontFamily: 'TCCC-UnityText, Inter, sans-serif'
      }
    }
  },
  legend: {
    position: 'bottom',
    fontSize: '11px',
    fontFamily: 'TCCC-UnityText, Inter, sans-serif',
    markers: { width: 10, height: 10, radius: 2 },
    itemMargin: { horizontal: 12, vertical: 4 }
  },
  grid: {
    borderColor: '#E5E7EB',
    strokeDashArray: 3
  },
  tooltip: {
    y: { formatter: (val) => val.toLocaleString() + ' consumers' }
  }
})
</script>

<template>
  <apexchart
    ref="chartRef"
    type="bar"
    :height="height"
    :options="chartOptions"
    :series="series"
  />
</template>
