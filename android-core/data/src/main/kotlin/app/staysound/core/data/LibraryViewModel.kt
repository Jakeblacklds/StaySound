package app.staysound.core.data

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.staysound.core.model.Catalog
import kotlinx.coroutines.flow.*

sealed interface LibraryUiState {
    data object Loading : LibraryUiState
    data class Ready(val catalog: Catalog) : LibraryUiState
    data class Failed(val cause: Throwable) : LibraryUiState
}

/** Projection only: UI never hydrates or writes an independent mutable library. */
class LibraryViewModel(repository: LibraryRepository) : ViewModel() {
    val state: StateFlow<LibraryUiState> = repository.catalog
        .map<Catalog, LibraryUiState> { LibraryUiState.Ready(it) }
        .catch { emit(LibraryUiState.Failed(it)) }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), LibraryUiState.Loading)
}
