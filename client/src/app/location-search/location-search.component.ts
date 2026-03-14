import { Component, inject, signal, AfterViewInit } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatAutocompleteModule, MatAutocomplete } from '@angular/material/autocomplete';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { Subject } from 'rxjs';
import { debounceTime, distinctUntilChanged, switchMap } from 'rxjs/operators';
import { LocationSearchService, type GeocodeResult } from '../services/location-search.service';
import { MapManagerService } from '../services/map-manager.service';

@Component({
  selector: 'app-location-search',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    MatFormFieldModule,
    MatInputModule,
    MatAutocompleteModule,
    MatIconModule,
    MatProgressSpinnerModule,
  ],
  templateUrl: './location-search.component.html',
  styleUrl: './location-search.component.scss',
})
export class LocationSearchComponent implements AfterViewInit {
  private locationSearch = inject(LocationSearchService);
  private mapManager = inject(MapManagerService);
  private router = inject(Router);

  searchControl = new FormControl<string>('', { nonNullable: true });
  results = signal<GeocodeResult[]>([]);
  loading = signal(false);

  displayLabel = (result: GeocodeResult | null): string => (result ? result.label : '');
  private searchSubject = new Subject<string>();

  ngAfterViewInit(): void {
    this.searchSubject
      .pipe(
        debounceTime(300),
        distinctUntilChanged(),
        switchMap((q) => {
          this.loading.set(true);
          return this.locationSearch.search(q);
        }),
      )
      .subscribe({
        next: (res) => {
          this.results.set(res.results ?? []);
          this.loading.set(false);
        },
        error: () => {
          this.results.set([]);
          this.loading.set(false);
        },
      });
  }

  onInput(): void {
    const value = this.searchControl.value.trim();
    if (!value) {
      this.results.set([]);
      return;
    }
    this.searchSubject.next(value);
  }

  onSelect(result: GeocodeResult): void {
    this.locationSearch.setResultToShow(result);
    const uuid = this.mapManager.currentMapUuid();
    if (uuid) {
      this.router.navigate(['/map', uuid]);
    } else {
      this.router.navigate(['/map']);
    }
    this.searchControl.setValue('');
    this.results.set([]);
  }
}
