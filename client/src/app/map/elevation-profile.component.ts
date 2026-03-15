import {
  Component,
  ElementRef,
  OnDestroy,
  AfterViewInit,
  ViewChild,
  input,
  output,
  effect,
} from '@angular/core';
import {
  Chart,
  LineController,
  LineElement,
  PointElement,
  LinearScale,
  Filler,
  Tooltip,
} from 'chart.js';

Chart.register(LineController, LineElement, PointElement, LinearScale, Filler, Tooltip);

@Component({
  selector: 'app-elevation-profile',
  templateUrl: './elevation-profile.component.html',
  styleUrl: './elevation-profile.component.scss',
})
export class ElevationProfileComponent implements AfterViewInit, OnDestroy {
  @ViewChild('chartCanvas') private canvasRef!: ElementRef<HTMLCanvasElement>;

  profileData = input<[number, number][] | null>(null);
  closed = output<void>();

  private chart: Chart | null = null;
  private viewReady = false;

  get isVisible(): boolean {
    const data = this.profileData();
    return data != null && data.length > 0;
  }

  constructor() {
    effect(() => {
      const data = this.profileData();
      if (this.viewReady) {
        this.renderChart(data);
      }
    });
  }

  ngAfterViewInit(): void {
    this.viewReady = true;
    this.renderChart(this.profileData());
  }

  ngOnDestroy(): void {
    this.chart?.destroy();
  }

  onClose(): void {
    this.closed.emit();
  }

  private renderChart(data: [number, number][] | null): void {
    this.chart?.destroy();
    this.chart = null;

    if (!data || data.length === 0) return;

    const points = data.map(([dist_m, elev_m]) => ({ x: dist_m / 1000, y: elev_m }));

    this.chart = new Chart(this.canvasRef.nativeElement, {
      type: 'line',
      data: {
        datasets: [
          {
            data: points,
            borderColor: '#e65100',
            backgroundColor: 'rgba(230, 81, 0, 0.12)',
            borderWidth: 1.5,
            fill: true,
            tension: 0.15,
            pointRadius: 0,
            pointHitRadius: 10,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              title: (items) => {
                const x = items[0]?.parsed?.x;
                return x != null ? `${x.toFixed(1)} km` : '';
              },
              label: (item) => `${item.parsed.y} m`,
            },
          },
        },
        scales: {
          x: {
            type: 'linear',
            title: { display: true, text: 'Distance (km)', font: { size: 11 } },
            ticks: {
              maxTicksLimit: 10,
              font: { size: 10 },
              callback: (value) => Number(value).toFixed(1),
            },
            grid: { display: false },
          },
          y: {
            title: { display: true, text: 'Elevation (m)', font: { size: 11 } },
            ticks: { font: { size: 10 } },
          },
        },
      },
    });
  }
}
