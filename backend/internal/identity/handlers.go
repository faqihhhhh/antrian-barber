package identity

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"time"

	"kapsflow/internal/httpx"
)

type Handlers struct {
	svc *Service
	log *slog.Logger
}

func NewHandlers(svc *Service, log *slog.Logger) *Handlers {
	return &Handlers{svc: svc, log: log}
}

type registerRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

func (h *Handlers) Register(w http.ResponseWriter, r *http.Request) {
	var req registerRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpx.Error(w, r, h.log, httpx.BadRequest("body_tidak_valid", "Format request tidak valid", err))
		return
	}
	if err := h.svc.Register(r.Context(), req.Email, req.Password); err != nil {
		httpx.Error(w, r, h.log, err)
		return
	}
	httpx.JSON(w, http.StatusAccepted, map[string]string{
		"message": "Kalau email valid dan belum terdaftar, tautan verifikasi sudah dikirim",
	})
}

// VerifyEmail dibuka langsung dari email (GET), jadi membalas HTML, bukan JSON.
func (h *Handlers) VerifyEmail(w http.ResponseWriter, r *http.Request) {
	token := r.URL.Query().Get("token")
	if token == "" {
		writeSimpleHTML(w, http.StatusBadRequest, "Tautan tidak valid", "Token tidak ditemukan pada tautan ini.")
		return
	}
	if err := h.svc.VerifyEmail(r.Context(), token); err != nil {
		writeSimpleHTML(w, http.StatusBadRequest, "Verifikasi gagal", "Tautan tidak valid atau sudah kedaluwarsa. Silakan minta tautan baru.")
		return
	}
	writeSimpleHTML(w, http.StatusOK, "Email terverifikasi", "Akun Anda sudah aktif. Silakan kembali ke aplikasi dan masuk.")
}

type loginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

func (h *Handlers) Login(w http.ResponseWriter, r *http.Request) {
	var req loginRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpx.Error(w, r, h.log, httpx.BadRequest("body_tidak_valid", "Format request tidak valid", err))
		return
	}
	rawToken, err := h.svc.Login(r.Context(), req.Email, req.Password)
	if err != nil {
		httpx.Error(w, r, h.log, err)
		return
	}
	http.SetCookie(w, &http.Cookie{
		Name:     SessionCookieName,
		Value:    rawToken,
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Secure:   r.TLS != nil, // otomatis true di produksi (HTTPS)
		Expires:  time.Now().Add(sessionTTL),
	})
	httpx.JSON(w, http.StatusOK, map[string]string{"message": "Berhasil masuk"})
}

func (h *Handlers) Logout(w http.ResponseWriter, r *http.Request) {
	if cookie, err := r.Cookie(SessionCookieName); err == nil {
		_ = h.svc.Logout(r.Context(), cookie.Value)
	}
	http.SetCookie(w, &http.Cookie{Name: SessionCookieName, Value: "", Path: "/", HttpOnly: true, MaxAge: -1})
	httpx.JSON(w, http.StatusOK, map[string]string{"message": "Berhasil keluar"})
}

func (h *Handlers) Me(w http.ResponseWriter, r *http.Request) {
	user, ok := UserFromContext(r.Context())
	if !ok {
		httpx.Error(w, r, h.log, httpx.Unauthorized("belum_login", "Anda belum masuk", nil))
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"id": user.ID, "email": user.Email})
}

type forgotPasswordRequest struct {
	Email string `json:"email"`
}

func (h *Handlers) ForgotPassword(w http.ResponseWriter, r *http.Request) {
	var req forgotPasswordRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpx.Error(w, r, h.log, httpx.BadRequest("body_tidak_valid", "Format request tidak valid", err))
		return
	}
	if err := h.svc.RequestPasswordReset(r.Context(), req.Email); err != nil {
		httpx.Error(w, r, h.log, err)
		return
	}
	httpx.JSON(w, http.StatusAccepted, map[string]string{
		"message": "Kalau email terdaftar, tautan reset password sudah dikirim",
	})
}

// ResetPasswordPage menampilkan form HTML sederhana saat tautan email
// diklik — pengganti sementara sampai frontend React ada.
func (h *Handlers) ResetPasswordPage(w http.ResponseWriter, r *http.Request) {
	token := r.URL.Query().Get("token")
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	fmt.Fprintf(w, `<!doctype html><html><body style="font-family:sans-serif;max-width:400px;margin:40px auto">
		<h2>Atur ulang password</h2>
		<form method="POST" action="/v1/auth/reset-password">
			<input type="hidden" name="token" value="%s">
			<input type="password" name="password" placeholder="Password baru" minlength="8" required style="width:100%%;padding:8px;margin:8px 0">
			<button type="submit" style="width:100%%;padding:10px;background:#111827;color:#fff;border:none;border-radius:6px">Simpan Password</button>
		</form></body></html>`, token)
}

// ResetPasswordSubmit menerima form HTML (interim) maupun JSON (dipakai
// frontend nanti), dibedakan lewat Content-Type.
func (h *Handlers) ResetPasswordSubmit(w http.ResponseWriter, r *http.Request) {
	isJSON := r.Header.Get("Content-Type") == "application/json"
	var token, password string

	if isJSON {
		var req struct {
			Token    string `json:"token"`
			Password string `json:"password"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			httpx.Error(w, r, h.log, httpx.BadRequest("body_tidak_valid", "Format request tidak valid", err))
			return
		}
		token, password = req.Token, req.Password
	} else {
		if err := r.ParseForm(); err != nil {
			writeSimpleHTML(w, http.StatusBadRequest, "Gagal", "Form tidak valid.")
			return
		}
		token, password = r.PostFormValue("token"), r.PostFormValue("password")
	}

	err := h.svc.ResetPassword(r.Context(), token, password)

	if isJSON {
		if err != nil {
			httpx.Error(w, r, h.log, err)
			return
		}
		httpx.JSON(w, http.StatusOK, map[string]string{"message": "Password berhasil diubah"})
		return
	}
	if err != nil {
		writeSimpleHTML(w, http.StatusBadRequest, "Gagal reset password", "Tautan tidak valid, kedaluwarsa, atau password kurang dari 8 karakter.")
		return
	}
	writeSimpleHTML(w, http.StatusOK, "Password berhasil diubah", "Silakan kembali ke aplikasi dan masuk dengan password baru Anda.")
}

func writeSimpleHTML(w http.ResponseWriter, status int, title, message string) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.WriteHeader(status)
	fmt.Fprintf(w, `<!doctype html><html><body style="font-family:sans-serif;max-width:400px;margin:80px auto;text-align:center">
		<h2>%s</h2><p>%s</p></body></html>`, title, message)
}