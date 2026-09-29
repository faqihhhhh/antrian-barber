package identity

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	db "kapsflow/internal/db"
	"kapsflow/internal/dbx"
	"kapsflow/internal/httpx"
)

const (
	emailVerificationTTL = 24 * time.Hour
	passwordResetTTL     = 1 * time.Hour
	sessionTTL           = 30 * 24 * time.Hour
	SessionCookieName    = "kapsflow_session"
)

type Service struct {
	q       *db.Queries
	mailer  Mailer
	log     *slog.Logger
	baseURL string // alamat publik backend, dipakai membangun tautan di email
}

func NewService(pool *pgxpool.Pool, mailer Mailer, log *slog.Logger, baseURL string) *Service {
	return &Service{q: db.New(pool), mailer: mailer, log: log, baseURL: baseURL}
}

// Register mendaftarkan akun baru dan mengirim email verifikasi. Kalau
// email sudah ada tapi belum terverifikasi, dianggap percobaan ulang dan
// email verifikasi dikirim lagi. Kalau sudah terverifikasi, balasannya
// tetap "sukses" ke pemanggil, supaya tidak membocorkan email siapa saja
// yang sudah terdaftar.
func (s *Service) Register(ctx context.Context, email, password string) error {
	if len(password) < 8 {
		return httpx.BadRequest("password_terlalu_pendek", "Password minimal 8 karakter", nil)
	}

	existing, err := s.q.GetUserByEmail(ctx, email)
	if err == nil {
		if existing.EmailVerifiedAt.Valid {
			return nil
		}
		return s.sendVerificationEmail(ctx, existing.ID, existing.Email)
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return httpx.Internal(fmt.Errorf("cek user existing: %w", err))
	}

	hash, err := HashPassword(password)
	if err != nil {
		return httpx.Internal(fmt.Errorf("hash password: %w", err))
	}

	user, err := s.q.CreateUser(ctx, db.CreateUserParams{Email: email, PasswordHash: hash})
	if err != nil {
		return httpx.Internal(fmt.Errorf("membuat user: %w", err))
	}

	return s.sendVerificationEmail(ctx, user.ID, user.Email)
}

func (s *Service) sendVerificationEmail(ctx context.Context, userID uuid.UUID, email string) error {
	rawToken, err := generateToken()
	if err != nil {
		return httpx.Internal(err)
	}

	_, err = s.q.CreateEmailVerificationToken(ctx, db.CreateEmailVerificationTokenParams{
		UserID:    userID,
		TokenHash: hashToken(rawToken),
		ExpiresAt: dbx.TS(time.Now().Add(emailVerificationTTL)),
	})
	if err != nil {
		return httpx.Internal(fmt.Errorf("menyimpan token verifikasi: %w", err))
	}

	verifyURL := fmt.Sprintf("%s/v1/auth/verify-email?token=%s", s.baseURL, rawToken)
	if err := s.mailer.Send(ctx, email, "Verifikasi email Kapsflow Anda", verificationEmailHTML(verifyURL)); err != nil {
		return httpx.Internal(fmt.Errorf("mengirim email verifikasi: %w", err))
	}
	return nil
}

func (s *Service) VerifyEmail(ctx context.Context, rawToken string) error {
	row, err := s.q.GetValidEmailVerificationToken(ctx, hashToken(rawToken))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return httpx.BadRequest("token_tidak_valid", "Tautan verifikasi tidak valid atau sudah kedaluwarsa", nil)
		}
		return httpx.Internal(fmt.Errorf("cek token verifikasi: %w", err))
	}
	if err := s.q.MarkEmailVerificationTokenUsed(ctx, row.ID); err != nil {
		return httpx.Internal(fmt.Errorf("menandai token terpakai: %w", err))
	}
	if err := s.q.MarkUserEmailVerified(ctx, row.UserID); err != nil {
		return httpx.Internal(fmt.Errorf("menandai email terverifikasi: %w", err))
	}
	return nil
}

// Login mengembalikan token sesi mentah untuk disimpan sebagai cookie oleh handler.
func (s *Service) Login(ctx context.Context, email, password string) (string, error) {
	user, err := s.q.GetUserByEmail(ctx, email)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return "", httpx.Unauthorized("kredensial_salah", "Email atau password salah", nil)
		}
		return "", httpx.Internal(fmt.Errorf("ambil user: %w", err))
	}

	if !user.EmailVerifiedAt.Valid {
		return "", httpx.Forbidden("email_belum_verifikasi", "Verifikasi email Anda terlebih dahulu", nil)
	}
	if err := VerifyPassword(password, user.PasswordHash); err != nil {
		return "", httpx.Unauthorized("kredensial_salah", "Email atau password salah", nil)
	}

	rawToken, err := generateToken()
	if err != nil {
		return "", httpx.Internal(err)
	}
	_, err = s.q.CreateSession(ctx, db.CreateSessionParams{
		UserID:    user.ID,
		TokenHash: hashToken(rawToken),
		ExpiresAt: dbx.TS(time.Now().Add(sessionTTL)),
	})
	if err != nil {
		return "", httpx.Internal(fmt.Errorf("membuat sesi: %w", err))
	}
	return rawToken, nil
}

func (s *Service) Logout(ctx context.Context, rawToken string) error {
	if err := s.q.DeleteSession(ctx, hashToken(rawToken)); err != nil {
		return httpx.Internal(fmt.Errorf("menghapus sesi: %w", err))
	}
	return nil
}

// CurrentUser dipakai middleware auth untuk menerjemahkan cookie sesi
// menjadi data user yang sedang login.
func (s *Service) CurrentUser(ctx context.Context, rawToken string) (db.User, error) {
	session, err := s.q.GetValidSession(ctx, hashToken(rawToken))
	if err != nil {
		return db.User{}, httpx.Unauthorized("sesi_tidak_valid", "Sesi tidak valid atau sudah berakhir", nil)
	}
	_ = s.q.TouchSession(ctx, session.ID) // gagal di sini bukan hal fatal

	user, err := s.q.GetUserByID(ctx, session.UserID)
	if err != nil {
		return db.User{}, httpx.Internal(fmt.Errorf("ambil user dari sesi: %w", err))
	}
	return user, nil
}

// RequestPasswordReset selalu sukses secara diam-diam kalau email tidak
// ditemukan, dengan alasan yang sama seperti Register.
func (s *Service) RequestPasswordReset(ctx context.Context, email string) error {
	user, err := s.q.GetUserByEmail(ctx, email)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil
		}
		return httpx.Internal(fmt.Errorf("cek user: %w", err))
	}

	rawToken, err := generateToken()
	if err != nil {
		return httpx.Internal(err)
	}
	_, err = s.q.CreatePasswordResetToken(ctx, db.CreatePasswordResetTokenParams{
		UserID:    user.ID,
		TokenHash: hashToken(rawToken),
		ExpiresAt: dbx.TS(time.Now().Add(passwordResetTTL)),
	})
	if err != nil {
		return httpx.Internal(fmt.Errorf("menyimpan token reset: %w", err))
	}

	resetURL := fmt.Sprintf("%s/v1/auth/reset-password?token=%s", s.baseURL, rawToken)
	if err := s.mailer.Send(ctx, user.Email, "Atur ulang password Kapsflow Anda", passwordResetEmailHTML(resetURL)); err != nil {
		return httpx.Internal(fmt.Errorf("mengirim email reset: %w", err))
	}
	return nil
}

func (s *Service) ResetPassword(ctx context.Context, rawToken, newPassword string) error {
	if len(newPassword) < 8 {
		return httpx.BadRequest("password_terlalu_pendek", "Password minimal 8 karakter", nil)
	}

	row, err := s.q.GetValidPasswordResetToken(ctx, hashToken(rawToken))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return httpx.BadRequest("token_tidak_valid", "Tautan reset password tidak valid atau sudah kedaluwarsa", nil)
		}
		return httpx.Internal(fmt.Errorf("cek token reset: %w", err))
	}

	hash, err := HashPassword(newPassword)
	if err != nil {
		return httpx.Internal(err)
	}
	if err := s.q.UpdateUserPassword(ctx, db.UpdateUserPasswordParams{ID: row.UserID, PasswordHash: hash}); err != nil {
		return httpx.Internal(fmt.Errorf("update password: %w", err))
	}
	if err := s.q.MarkPasswordResetTokenUsed(ctx, row.ID); err != nil {
		return httpx.Internal(fmt.Errorf("menandai token reset terpakai: %w", err))
	}
	return nil
}