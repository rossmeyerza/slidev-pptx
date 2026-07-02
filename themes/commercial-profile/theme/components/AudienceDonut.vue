<script setup>
import { ref } from 'vue'
import { useChartReveal } from '../composables/useChartReveal'

const props = defineProps({
  labels: { type: Array, default: () => ['Coke 1PD Only', 'Overlap', 'Shoprite Only'] },
  series: { type: Array, default: () => [828060, 483225, 14550394] },
  colors: { type: Array, default: () => ['#9CA3AF', '#E61D2B', '#F87171'] },
  height: { type: Number, default: 220 }
})

const realData = props.series
const zeroData = realData.map(() => 0)
const { series, chartRef } = useChartReveal(realData, zeroData)

const chartOptions = ref({
  chart: {
    type: 'donut',
    animations: {
      enabled: true,
      easing: 'easeinout',
      speed: 1200,
      animateGradually: { enabled: true, delay: 200 }
    }
  },
  labels: props.labels,
  colors: props.colors,
  legend: {
    position: 'bottom',
    fontSize: '11px',
    fontFamily: 'TCCC-UnityText, Inter, sans-serif',
    markers: { width: 10, height: 10, radius: 2 },
    itemMargin: { horizontal: 8, vertical: 4 }
  },
  dataLabels: {
    enabled: true,
    formatter: (val, opts) => {
      const v = opts.w.config.series[opts.seriesIndex]
      if (v >= 1000000) return (v / 1000000).toFixed(1) + 'M'
      if (v >= 1000) return Math.round(v / 1000) + 'K'
      return v.toLocaleString()
    },
    style: {
      fontSize: '11px',
      fontFamily: 'TCCC-UnityText, Inter, sans-serif',
      fontWeight: 700,
      colors: ['#111827']
    },
    dropShadow: { enabled: false }
  },
  plotOptions: {
    pie: {
      donut: {
        size: '55%',
        labels: {
          show: true,
          name: { show: true, fontSize: '12px', fontFamily: 'TCCC-UnityText, Inter, sans-serif' },
          value: {
            show: true,
            fontSize: '14px',
            fontFamily: 'TCCC-UnityText, Inter, sans-serif',
            fontWeight: 800,
            formatter: (val) => Number(val).toLocaleString()
          },
          total: {
            show: true,
            label: 'Total',
            fontSize: '11px',
            fontFamily: 'TCCC-UnityText, Inter, sans-serif',
            formatter: (w) => w.globals.seriesTotals.reduce((a, b) => a + b, 0).toLocaleString()
          }
        }
      }
    }
  },
  stroke: { width: 2, colors: ['#fff'] },
  tooltip: {
    y: { formatter: (val) => val.toLocaleString() + ' consumers' }
  }
})
</script>

<template>
  <apexchart
    ref="chartRef"
    type="donut"
    :height="height"
    :options="chartOptions"
    :series="series"
  />
</template>
