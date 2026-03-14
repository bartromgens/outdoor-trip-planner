import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatTimepickerModule } from '@angular/material/timepicker';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { TripDateTimeService } from '../services/trip-datetime.service';

@Component({
  selector: 'app-departure-datetime-picker',
  imports: [
    FormsModule,
    MatButtonModule,
    MatIconModule,
    MatDatepickerModule,
    MatTimepickerModule,
    MatInputModule,
    MatFormFieldModule,
  ],
  templateUrl: './departure-datetime-picker.component.html',
  styleUrl: './departure-datetime-picker.component.scss',
})
export class DepartureDatetimePickerComponent {
  private tripDateTime = inject(TripDateTimeService);

  pickerDate: Date | null = null;
  pickerTime: Date | null = null;

  get hasValue(): boolean {
    return this.pickerDate !== null || this.pickerTime !== null;
  }

  onDateChange(): void {
    this._syncToService();
  }

  onTimeChange(): void {
    this._syncToService();
  }

  clear(): void {
    this.pickerDate = null;
    this.pickerTime = null;
    this.tripDateTime.set(null);
  }

  private _syncToService(): void {
    if (!this.pickerDate) {
      this.tripDateTime.set(null);
      return;
    }
    const d = new Date(this.pickerDate);
    if (this.pickerTime) {
      d.setHours(this.pickerTime.getHours(), this.pickerTime.getMinutes(), 0, 0);
    } else {
      d.setHours(0, 0, 0, 0);
    }
    this.tripDateTime.set(d);
  }
}
