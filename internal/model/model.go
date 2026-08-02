// Package model holds the domain types that map to database rows.
//
// Structs here are plain data with json/db tags — no ORM, no behaviour, no
// database access. Queries live alongside the handlers that need them so the
// SQL stays visible at the call site.
package model

import "time"

// User is a registered Tapago account.
//
// PasswordHash is json:"-" so it can never leak through a response body, even
// if a handler accidentally marshals the whole struct.
type User struct {
	ID           string    `json:"id"`
	Email        string    `json:"email"`
	PasswordHash string    `json:"-"`
	CreatedAt    time.Time `json:"createdAt"`
	UpdatedAt    time.Time `json:"updatedAt"`
}
