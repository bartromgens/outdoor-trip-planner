import { Injectable, signal, computed } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class TripDateTimeService {
  private readonly _departureTime = signal<Date | null>(null);
  readonly departureTime = this._departureTime.asReadonly();

  constructor() {
    const raw = new URLSearchParams(window.location.search).get('departure');
    if (raw) {
      const d = new Date(raw);
      if (!isNaN(d.getTime())) this._departureTime.set(d);
    }
  }

  readonly inputValue = computed(() => {
    const d = this._departureTime();
    if (!d) return '';
    const pad = (n: number) => String(n).padStart(2, '0');
    return (
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
      `T${pad(d.getHours())}:${pad(d.getMinutes())}`
    );
  });

  set(date: Date | null): void {
    this._departureTime.set(date);
  }

  setFromInputValue(value: string): void {
    this._departureTime.set(value ? new Date(value) : null);
  }
}
