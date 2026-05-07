package expo.modules.soulseeknative

import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicReference

class SoulseekNativeModule : Module() {
  private val activeCancellation = AtomicReference<AtomicBoolean?>(null)
  private val nextOperationId = AtomicInteger(0)
  private val cancelledThroughOperationId = AtomicInteger(0)
  private val worker: ExecutorService = Executors.newSingleThreadExecutor { runnable ->
    Thread(runnable, "StaySoundSoulseekWorker").apply {
      isDaemon = true
      priority = Thread.NORM_PRIORITY - 1
    }
  }

  private fun rejectOperationError(
    promise: Promise,
    errorCode: String,
    cancelledCode: String,
    error: Throwable,
  ) {
    val message = error.message ?: error::class.java.simpleName
    if (message.contains("cancel", ignoreCase = true)) {
      promise.reject(cancelledCode, "Operacion Soulseek cancelada", error)
      return
    }

    promise.reject(errorCode, message, error)
  }

  override fun definition() = ModuleDefinition {
    Name("SoulseekNative")

    Function("isAvailable") {
      true
    }

    AsyncFunction("search") { config: Map<String, Any?>, query: String, timeoutMs: Int, maxResults: Int, promise: Promise ->
      val normalizedQuery = query.trim()
      if (normalizedQuery.isEmpty()) {
        promise.resolve(emptyList<Map<String, Any?>>())
        return@AsyncFunction
      }

      val parsedConfig = SoulseekConfig.from(config)
      val normalizedTimeout = timeoutMs.coerceIn(2500, 30000)
      val normalizedMax = maxResults.coerceIn(1, 120)
      val operationCancelled = AtomicBoolean(false)
      val operationId = nextOperationId.incrementAndGet()

      worker.execute {
        if (operationId <= cancelledThroughOperationId.get()) {
          promise.reject("ERR_SOULSEEK_SEARCH_CANCELLED", "Operacion Soulseek cancelada", null)
          return@execute
        }

        activeCancellation.set(operationCancelled)
        try {
          val results = SoulseekClient(operationCancelled)
            .search(parsedConfig, normalizedQuery, normalizedTimeout, normalizedMax)
            .map { it.toMap() }

          promise.resolve(results)
        } catch (error: Throwable) {
          rejectOperationError(promise, "ERR_SOULSEEK_SEARCH", "ERR_SOULSEEK_SEARCH_CANCELLED", error)
        } finally {
          activeCancellation.compareAndSet(operationCancelled, null)
        }
      }
    }

    AsyncFunction("download") { config: Map<String, Any?>, match: Map<String, Any?>, outputPath: String, promise: Promise ->
      val parsedConfig = SoulseekConfig.from(config)
      val parsedMatch = SoulseekMatch.from(match)
      val operationCancelled = AtomicBoolean(false)
      val operationId = nextOperationId.incrementAndGet()

      worker.execute {
        if (operationId <= cancelledThroughOperationId.get()) {
          promise.reject("ERR_SOULSEEK_DOWNLOAD_CANCELLED", "Operacion Soulseek cancelada", null)
          return@execute
        }

        activeCancellation.set(operationCancelled)
        try {
          val result = SoulseekClient(operationCancelled).download(parsedConfig, parsedMatch, outputPath)

          promise.resolve(
            mapOf(
              "path" to result.path,
              "bytesWritten" to result.bytesWritten,
            ),
          )
        } catch (error: Throwable) {
          rejectOperationError(promise, "ERR_SOULSEEK_DOWNLOAD", "ERR_SOULSEEK_DOWNLOAD_CANCELLED", error)
        } finally {
          activeCancellation.compareAndSet(operationCancelled, null)
        }
      }
    }

    AsyncFunction("cancelActiveOperations") {
      cancelledThroughOperationId.set(nextOperationId.get())
      activeCancellation.get()?.set(true)
      null
    }
  }
}
