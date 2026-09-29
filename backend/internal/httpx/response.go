package httpx

import (
	"encoding/json"
	"log/slog"
	"net/http"
)

// JSON menulis data sebagai respons JSON dengan status kode tertentu.
func JSON(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if data == nil {
		return
	}
	_ = json.NewEncoder(w).Encode(data)
}

// Error menulis AppError sebagai respons JSON. Kalau error yang masuk bukan
// *AppError (artinya tidak terduga), dibungkus jadi 500 dulu.
func Error(w http.ResponseWriter, r *http.Request, log *slog.Logger, err error) {
	appErr, ok := err.(*AppError)
	if !ok {
		appErr = Internal(err)
	}

	if appErr.Status >= 500 {
		log.Error("request gagal",
			"path", r.URL.Path,
			"method", r.Method,
			"code", appErr.Code,
			"err", appErr.Error(),
		)
	}

	JSON(w, appErr.Status, map[string]any{
		"error": map[string]string{
			"code":    appErr.Code,
			"message": appErr.Message,
		},
	})
}