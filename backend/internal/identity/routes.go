package identity

import (
	"log/slog"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"

	"kapsflow/internal/ratelimit"
)

func Routes(svc *Service, log *slog.Logger, secureCookies bool) http.Handler {
	h := NewHandlers(svc, log, secureCookies)
	r := chi.NewRouter()
	loginLimiter := ratelimit.New(10, time.Minute)
	accountCreationLimiter := ratelimit.New(5, time.Minute)
	verificationLimiter := ratelimit.New(10, time.Minute)
	passwordResetLimiter := ratelimit.New(5, time.Minute)
	resendVerificationLimiter := ratelimit.New(3, time.Minute)

	r.With(accountCreationLimiter.Middleware(log)).Post("/register", h.Register)
	r.With(verificationLimiter.Middleware(log)).Get("/verify-email", h.VerifyEmail)
	r.With(loginLimiter.Middleware(log)).Post("/login", h.Login)
	r.Post("/logout", h.Logout)
	r.With(passwordResetLimiter.Middleware(log)).Post("/forgot-password", h.ForgotPassword)
	r.Get("/reset-password", h.ResetPasswordPage)
	r.With(passwordResetLimiter.Middleware(log)).Post("/reset-password", h.ResetPasswordSubmit)
	r.With(verificationLimiter.Middleware(log)).Post("/verify-email", h.VerifyEmailAPI)
	r.With(resendVerificationLimiter.Middleware(log)).Post("/resend-verification", h.ResendVerification)

	r.Group(func(pr chi.Router) {
		pr.Use(RequireAuth(svc, log))
		pr.Get("/me", h.Me)
	})

	return r
}
