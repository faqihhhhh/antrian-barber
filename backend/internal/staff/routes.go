package staff

import (
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"
)

func RegisterRoutes(r chi.Router, svc *Service, log *slog.Logger, requireActive func(http.Handler) http.Handler) {
	h := NewHandlers(svc, log)
	r.Get("/{tenantID}/staff", h.ListStaff)
	r.With(requireActive).Put("/{tenantID}/staff/{membershipID}", h.UpdateStaff)
	r.With(requireActive).Delete("/{tenantID}/staff/{membershipID}", h.RemoveStaff)
	r.With(requireActive).Post("/{tenantID}/staff/invitations", h.CreateInvitationLink)
	r.Get("/{tenantID}/staff/invitations", h.ListInvitationLinks)
	r.With(requireActive).Delete("/{tenantID}/staff/invitations/{invitationID}", h.RevokeInvitationLink)
	r.Get("/{tenantID}/staff/applications", h.ListApplications)
	r.With(requireActive).Post("/{tenantID}/staff/applications/{applicationID}/{decision:approve|reject}", h.ReviewApplication)
}

func RegisterPublicRoutes(r chi.Router, svc *Service, log *slog.Logger) {
	r.Get("/staff-invitations", NewHandlers(svc, log).LookupInvitation)
}

func RegisterMyRoutes(r chi.Router, svc *Service, log *slog.Logger) {
	r.Post("/staff-applications", NewHandlers(svc, log).ApplyForStaff)
}
