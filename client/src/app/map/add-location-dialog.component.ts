import { Component, inject } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';

export interface AddLocationDialogData {
  lat?: number;
  lng?: number;
  title?: string;
  initialName?: string;
  initialCategory?: string;
  initialDescription?: string;
}

export interface AddLocationDialogResult {
  name: string;
  category: string;
  description: string;
}

const CATEGORIES = [
  { value: '', label: '— none —' },
  { value: 'peak', label: 'Peak' },
  { value: 'hut', label: 'Hut' },
  { value: 'campsite', label: 'Campsite' },
  { value: 'trail', label: 'Trail' },
  { value: 'water', label: 'Water' },
  { value: 'viewpoint', label: 'Viewpoint' },
  { value: 'parking', label: 'Parking' },
  { value: 'station', label: 'Station' },
];

@Component({
  selector: 'app-add-location-dialog',
  standalone: true,
  imports: [
    MatDialogModule,
    ReactiveFormsModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatButtonModule,
  ],
  template: `
    <h2 mat-dialog-title>{{ dialogTitle }}</h2>
    <mat-dialog-content>
      @if (data.lat != null && data.lng != null) {
        <p class="coords">{{ data.lat.toFixed(5) }}, {{ data.lng.toFixed(5) }}</p>
      }
      <form [formGroup]="form" id="add-location-form" (ngSubmit)="submit()">
        <mat-form-field appearance="outline" class="full-width">
          <mat-label>Name</mat-label>
          <input matInput formControlName="name" autocomplete="off" />
          @if (form.controls.name.hasError('required') && form.controls.name.touched) {
            <mat-error>Name is required</mat-error>
          }
        </mat-form-field>

        <mat-form-field appearance="outline" class="full-width">
          <mat-label>Category</mat-label>
          <mat-select formControlName="category">
            @for (cat of categories; track cat.value) {
              <mat-option [value]="cat.value">{{ cat.label }}</mat-option>
            }
          </mat-select>
        </mat-form-field>

        <mat-form-field appearance="outline" class="full-width">
          <mat-label>Description</mat-label>
          <textarea matInput formControlName="description" rows="3"></textarea>
        </mat-form-field>
      </form>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Cancel</button>
      <button mat-raised-button color="primary" form="add-location-form" type="submit">Save</button>
    </mat-dialog-actions>
  `,
  styles: [
    `
      .coords {
        color: #666;
        font-size: 12px;
        margin: 0 0 12px;
      }
      .full-width {
        width: 100%;
      }
      mat-dialog-content {
        min-width: 300px;
      }
    `,
  ],
})
export class AddLocationDialogComponent {
  readonly data = inject<AddLocationDialogData>(MAT_DIALOG_DATA);
  private readonly dialogRef = inject(MatDialogRef<AddLocationDialogComponent>);

  readonly categories = CATEGORIES;
  readonly dialogTitle = this.data.title ?? 'Add location';

  readonly form = new FormGroup({
    name: new FormControl(this.data.initialName ?? '', {
      nonNullable: true,
      validators: [Validators.required],
    }),
    category: new FormControl(this.data.initialCategory ?? '', { nonNullable: true }),
    description: new FormControl(this.data.initialDescription ?? '', { nonNullable: true }),
  });

  submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const result: AddLocationDialogResult = {
      name: this.form.controls.name.value,
      category: this.form.controls.category.value,
      description: this.form.controls.description.value,
    };
    this.dialogRef.close(result);
  }
}
