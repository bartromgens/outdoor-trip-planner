import { Component, inject } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';

export interface SaveHikeDialogData {
  existingName?: string;
  existingColor?: string;
}

export interface SaveHikeDialogResult {
  name: string;
  color: string;
}

const DEFAULT_COLOR = '#1565c0';

@Component({
  selector: 'app-save-hike-dialog',
  standalone: true,
  imports: [
    MatDialogModule,
    ReactiveFormsModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
  ],
  template: `
    <h2 mat-dialog-title>{{ data.existingName ? 'Rename hike route' : 'Save hike route' }}</h2>
    <mat-dialog-content>
      <form [formGroup]="form" id="save-hike-form" (ngSubmit)="submit()">
        <mat-form-field appearance="outline" class="full-width">
          <mat-label>Route name</mat-label>
          <input matInput formControlName="name" autocomplete="off" />
          @if (form.controls.name.hasError('required') && form.controls.name.touched) {
            <mat-error>Name is required</mat-error>
          }
        </mat-form-field>
        <div class="color-row">
          <label class="color-label" for="trail-color">Trail color</label>
          <input
            id="trail-color"
            type="color"
            formControlName="color"
            class="color-input"
          />
        </div>
      </form>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Cancel</button>
      <button mat-raised-button color="primary" form="save-hike-form" type="submit">
        {{ data.existingName ? 'Update' : 'Save' }}
      </button>
    </mat-dialog-actions>
  `,
  styles: [
    `
      .full-width {
        width: 100%;
      }
      mat-dialog-content {
        min-width: 300px;
      }
      .color-row {
        display: flex;
        align-items: center;
        gap: 12px;
        margin-top: 4px;
        margin-bottom: 8px;
      }
      .color-label {
        font-size: 14px;
        color: rgba(0, 0, 0, 0.6);
      }
      .color-input {
        width: 48px;
        height: 32px;
        padding: 2px;
        border: 1px solid rgba(0, 0, 0, 0.38);
        border-radius: 4px;
        cursor: pointer;
        background: none;
      }
    `,
  ],
})
export class SaveHikeDialogComponent {
  readonly data = inject<SaveHikeDialogData>(MAT_DIALOG_DATA);
  private readonly dialogRef = inject(MatDialogRef<SaveHikeDialogComponent>);

  readonly form = new FormGroup({
    name: new FormControl(this.data.existingName ?? '', {
      nonNullable: true,
      validators: [Validators.required],
    }),
    color: new FormControl(this.data.existingColor ?? DEFAULT_COLOR, {
      nonNullable: true,
    }),
  });

  submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const result: SaveHikeDialogResult = {
      name: this.form.controls.name.value,
      color: this.form.controls.color.value,
    };
    this.dialogRef.close(result);
  }
}
