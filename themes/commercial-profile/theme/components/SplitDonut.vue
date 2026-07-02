<script setup>
import { ref } from 'vue'
import { useChartReveal } from '../composables/useChartReveal'

const props = defineProps({
  directLabel: { type: String, default: 'Direct (Coke 1PD)' },
  indirectLabel: { type: String, default: 'Indirect (Shoprite)' },
  directValue: { type: Number, default: 24055 },
  indirectValue: { type: Number, default: 474725 },
  directColor: { type: String, default: '#E61D2B' },
  indirectColor: { type: String, default: '#2E7D32' },
  height: { type: Number, default: 200 }
})

const realData = [props.directValue, props.indirectValue]
const zeroData = [0, 0]
const { series, chartRef } = useChartReveal(realData, zeroData)

const chartOptions = ref({
  chart: {
    type: 'donut',
    animations: {
      enabled: true,
      easing: 'easeinout',
      speed: 1000,
      animateGradually: { enabled: true, delay: 150 }
    }
  },
  labels: [props.directLabel, props.indirectLabel],
  colors: [props.directColor, props.indirectColor],
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
      fontSize: '12px',
      fontFamily: 'TCCC-UnityText, Inter, sans-serif',
      fontWeight: 700,
      colors: ['#111827']
    },
    dropShadow: { enabled: false }
  },
  plotOptions: {
    pie: {
      donut: {
        size: '50%',
        labels: {
          show: true,
          name: { show: true, fontSize: '11px', fontFamily: 'TCCC-UnityText, Inter, sans-serif' },
          value: {
            show: true,
            fontSize: '16px',
            fontFamily: 'TCCC-UnityText, Inter, sans-serif',
            fontWeight: 800,
            formatter: (val) => Number(val).toLocaleString()
          },
          total: {
            show: true,
            label: 'Total',
            fontSize: '10px',
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
