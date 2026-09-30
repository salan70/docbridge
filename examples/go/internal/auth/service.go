// Package auth is the DocBridge Go example.
package auth

import (
	"errors"
	"time"
)

const (
	// MaxAttempts bounds the login attempts per session.
	//
	// @doc docs/auth.md#max-attempts
	MaxAttempts = 3

	// defaultTimeout is unexported, so the default visibility skips it.
	defaultTimeout = 30 * time.Second
)

// Authenticator verifies credentials.
//
// @doc docs/auth.md#authenticator
type Authenticator interface {
	// Authenticate reports whether the credentials are valid.
	//
	// @doc docs/auth.md#authenticate
	Authenticate(email, password string) (bool, error)
}

// AuthService is the authentication service for the example.
//
// @doc docs/auth.md#auth-service
type AuthService struct {
	authenticator Authenticator
	timeout       time.Duration
}

// NewAuthService builds a service around an Authenticator.
//
// @doc docs/auth.md#constructing-the-service
func NewAuthService(authenticator Authenticator) *AuthService {
	return &AuthService{authenticator: authenticator, timeout: defaultTimeout}
}

/*
Login starts the login flow.

@doc docs/auth.md#login-flow
*/
func (s *AuthService) Login(email, password string) error {
	ok, err := s.authenticator.Authenticate(email, password)
	if err != nil {
		return err
	}
	if !ok {
		return errors.New("invalid credentials")
	}
	return nil
}
