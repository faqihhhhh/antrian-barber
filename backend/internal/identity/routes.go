package identity

import (
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"
)

func Routes(svc *Service, log *slog.Logger) http.Handler {
	h := NewHandlers(svc, log)
	r := chi.NewRouter()

	r.Post("/register", h.Register)
	r.Get("/verify-email", h.VerifyEmail)
	r.Post("/login", h.Login)
	r.Post("/logout", h.Logout)
	r.Post("/forgot-password", h.ForgotPassword)
	r.Get("/reset-password", h.ResetPasswordPage)
	r.Post("/reset-password", h.ResetPasswordSubmit)
	r.Post("/verify-email", h.VerifyEmailAPI)
	r.Post("/resend-verification", h.ResendVerification)

	r.Group(func(pr chi.Router) {
		pr.Use(RequireAuth(svc, log))
		pr.Get("/me", h.Me)
	})

	return r
}