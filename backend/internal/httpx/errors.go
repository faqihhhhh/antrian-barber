package httpx

import "net/http"

// AppError adalah error yang sudah punya status HTTP dan pesan yang aman
// ditampilkan ke pengguna. Semua handler sebaiknya mengembalikan *AppError,
// bukan error biasa, supaya format respons ke klien selalu konsisten.
type AppError struct {
	Status  int    `json:"-"`
	Code    string `json:"code"`
	Message string `json:"message"`
	Err     error  `json:"-"` // error asli untuk di-log, tidak dikirim ke klien
}

func (e *AppError) Error() string {
	if e.Err != nil {
		return e.Message + ": " + e.Err.Error()
	}
	return e.Message
}

func (e *AppError) Unwrap() error { return e.Err }

func BadRequest(code, message string, err error) *AppError {
	return &AppError{Status: http.StatusBadRequest, Code: code, Message: message, Err: err}
}

func Unauthorized(code, message string, err error) *AppError {
	return &AppError{Status: http.StatusUnauthorized, Code: code, Message: message, Err: err}
}

func Forbidden(code, message string, err error) *AppError {
	return &AppError{Status: http.StatusForbidden, Code: code, Message: message, Err: err}
}

func NotFound(code, message string, err error) *AppError {
	return &AppError{Status: http.StatusNotFound, Code: code, Message: message, Err: err}
}

func Conflict(code, message string, err error) *AppError {
	return &AppError{Status: http.StatusConflict, Code: code, Message: message, Err: err}
}

func ServiceUnavailable(code, message string, err error) *AppError {
	return &AppError{Status: http.StatusServiceUnavailable, Code: code, Message: message, Err: err}
}

func Internal(err error) *AppError {
	return &AppError{
		Status:  http.StatusInternalServerError,
		Code:    "internal_error",
		Message: "Terjadi kesalahan pada server, coba lagi nanti",
		Err:     err,
	}
}