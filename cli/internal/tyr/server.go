package tyr

import (
	"context"
	"database/sql"
	"fmt"
	"io/fs"
	"net/http"

	_ "github.com/lib/pq" // PostgreSQL driver

	"github.com/niuulabs/volundr/cli/internal/postgres"
	"github.com/niuulabs/volundr/cli/internal/tracker"
)

// Config holds configuration for the tyr-mini server.
type Config struct {
	// Enabled controls whether tyr-mini starts alongside Forge.
	Enabled bool
	// DatabaseDSN is the PostgreSQL connection string.
	DatabaseDSN string
	// ForgeURL is the base URL for the Forge server (for session dispatch).
	ForgeURL string
	// LinearAPIKey is the Linear API key for tracker integration.
	LinearAPIKey string
	// LinearTeamID is the Linear team ID (auto-discovered if empty).
	LinearTeamID string
	// AIModels is the list of available AI models for dispatch.
	AIModels []AIModel
	// DefaultSystemPrompt is the default system prompt for dispatched sessions.
	DefaultSystemPrompt string
	// ReviewerSystemPrompt is the system prompt for reviewer sessions.
	ReviewerSystemPrompt string
	// ReviewerModel is the AI model for reviewer sessions.
	ReviewerModel string
}

// AIModel represents an available AI model.
type AIModel struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// Server manages the tyr-mini lifecycle: database, migrations, and HTTP handlers.
type Server struct {
	cfg        *Config
	store      *Store
	handler    *Handler
	db         *sql.DB
	subscriber *ActivitySubscriber
	reviewer   *ReviewEngine
	cancel     context.CancelFunc
}

// NewServer creates and initializes a tyr-mini server.
func NewServer(cfg *Config) (*Server, error) {
	if cfg.DatabaseDSN == "" {
		return nil, fmt.Errorf("tyr-mini requires a database DSN")
	}

	db, err := sql.Open("postgres", cfg.DatabaseDSN)
	if err != nil {
		return nil, fmt.Errorf("open database: %w", err)
	}

	if err := db.PingContext(context.Background()); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("ping database: %w", err)
	}

	store := NewStore(db)
	dispatcher := NewDispatcher(cfg.ForgeURL)

	// Initialize tracker if a Linear API key is available.
	var t tracker.Tracker
	if cfg.LinearAPIKey != "" {
		t = tracker.NewLinearTracker(tracker.LinearConfig{
			APIKey: cfg.LinearAPIKey,
			TeamID: cfg.LinearTeamID,
		})
	}

	handler := NewHandler(store, dispatcher, t, cfg.AIModels, cfg.DefaultSystemPrompt)

	return &Server{
		cfg:     cfg,
		store:   store,
		handler: handler,
		db:      db,
	}, nil
}

// RunMigrations applies all Tyr SQL migrations from the embedded FS.
func (s *Server) RunMigrations(ctx context.Context) (int, error) {
	subFS, err := fs.Sub(sqlFS, "sql")
	if err != nil {
		return 0, fmt.Errorf("sub fs: %w", err)
	}

	return postgres.RunMigrationsWithFSTable(ctx, s.db, subFS, "tyr_schema_migrations")
}

// RegisterRoutes mounts tyr-mini's API handlers on the given mux.
func (s *Server) RegisterRoutes(mux *http.ServeMux) {
	s.handler.RegisterRoutes(mux)
}

// StartBackground starts the activity subscriber and review engine.
// Must be called after Forge's event bus and runner are available.
func (s *Server) StartBackground(events EventSource, pr PRChecker, spawner SessionSpawner) {
	ctx, cancel := context.WithCancel(context.Background())
	s.cancel = cancel

	s.subscriber = NewActivitySubscriber(s.store, events, pr, s.handler.tracker, SubscriberConfig{})

	reviewerModel := s.cfg.ReviewerModel
	if reviewerModel == "" {
		reviewerModel = "claude-sonnet-4-6"
	}
	s.reviewer = NewReviewEngine(s.store, pr, s.handler.tracker, spawner, ReviewEngineConfig{
		ReviewerSystemPrompt: s.cfg.ReviewerSystemPrompt,
		ReviewerModel:        reviewerModel,
	}, s.cfg.ForgeURL)
	s.reviewer.Start(s.subscriber)
	s.subscriber.Start(ctx)

	// Give the handler references for health reporting and event streaming.
	eventLog := NewEventLog(100)
	s.handler.subscriber = s.subscriber
	s.handler.reviewer = s.reviewer
	s.handler.eventLog = eventLog
	s.subscriber.eventLog = eventLog
	s.reviewer.eventLog = eventLog
}

// Close stops background services and closes the database connection.
func (s *Server) Close() error {
	if s.cancel != nil {
		s.cancel()
	}
	if s.db != nil {
		return s.db.Close()
	}
	return nil
}

// Store returns the underlying store (for CLI subcommands).
func (s *Server) Store() *Store {
	return s.store
}
