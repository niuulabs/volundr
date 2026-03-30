package tyr

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"testing/fstest"

	"github.com/DATA-DOG/go-sqlmock"
)

func TestRunTyrMigrations_NoFiles(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	mock.ExpectExec("CREATE TABLE IF NOT EXISTS tyr_schema_migrations").
		WillReturnResult(sqlmock.NewResult(0, 0))

	emptyFS := fstest.MapFS{}
	applied, err := runTyrMigrations(context.Background(), db, emptyFS)
	if err != nil {
		t.Fatalf("runTyrMigrations: %v", err)
	}
	if applied != 0 {
		t.Errorf("expected 0 applied, got %d", applied)
	}
}

func TestRunTyrMigrations_WithFiles(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	mock.ExpectExec("CREATE TABLE IF NOT EXISTS tyr_schema_migrations").
		WillReturnResult(sqlmock.NewResult(0, 0))

	mock.ExpectQuery("SELECT EXISTS").
		WithArgs("000001_test").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))

	mock.ExpectBegin()
	mock.ExpectExec("CREATE TABLE IF NOT EXISTS test_table").
		WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectExec("INSERT INTO tyr_schema_migrations").
		WithArgs("000001_test").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	testFS := fstest.MapFS{
		"000001_test.up.sql": &fstest.MapFile{
			Data: []byte("CREATE TABLE IF NOT EXISTS test_table (id INT);"),
		},
	}

	applied, err := runTyrMigrations(context.Background(), db, testFS)
	if err != nil {
		t.Fatalf("runTyrMigrations: %v", err)
	}
	if applied != 1 {
		t.Errorf("expected 1 applied, got %d", applied)
	}
}

func TestRunTyrMigrations_AlreadyApplied(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	mock.ExpectExec("CREATE TABLE IF NOT EXISTS tyr_schema_migrations").
		WillReturnResult(sqlmock.NewResult(0, 0))

	mock.ExpectQuery("SELECT EXISTS").
		WithArgs("000001_test").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))

	testFS := fstest.MapFS{
		"000001_test.up.sql": &fstest.MapFile{
			Data: []byte("CREATE TABLE IF NOT EXISTS test_table (id INT);"),
		},
	}

	applied, err := runTyrMigrations(context.Background(), db, testFS)
	if err != nil {
		t.Fatalf("runTyrMigrations: %v", err)
	}
	if applied != 0 {
		t.Errorf("expected 0 applied, got %d", applied)
	}
}

func TestRunTyrMigrations_CreateTableError(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	mock.ExpectExec("CREATE TABLE IF NOT EXISTS tyr_schema_migrations").
		WillReturnError(fmt.Errorf("permission denied"))

	testFS := fstest.MapFS{}
	_, err = runTyrMigrations(context.Background(), db, testFS)
	if err == nil {
		t.Fatal("expected error")
	}
}

func TestRunTyrMigrations_MigrationExecError(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	mock.ExpectExec("CREATE TABLE IF NOT EXISTS tyr_schema_migrations").
		WillReturnResult(sqlmock.NewResult(0, 0))

	mock.ExpectQuery("SELECT EXISTS").
		WithArgs("000001_bad").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))

	mock.ExpectBegin()
	mock.ExpectExec("INVALID SQL").
		WillReturnError(fmt.Errorf("syntax error"))
	mock.ExpectRollback()

	testFS := fstest.MapFS{
		"000001_bad.up.sql": &fstest.MapFile{
			Data: []byte("INVALID SQL"),
		},
	}

	_, err = runTyrMigrations(context.Background(), db, testFS)
	if err == nil {
		t.Fatal("expected error for bad SQL")
	}
}

func TestServerRegisterRoutes(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	store := NewStore(db)
	handler := NewHandler(store, nil)
	srv := &Server{handler: handler, store: store, db: db}

	mux := http.NewServeMux()
	srv.RegisterRoutes(mux)

	// Verify health endpoint is registered.
	mock.ExpectPing()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/tyr/health", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200 from health after RegisterRoutes, got %d", w.Code)
	}
}

func TestRunTyrMigrations_CheckError(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	mock.ExpectExec("CREATE TABLE IF NOT EXISTS tyr_schema_migrations").
		WillReturnResult(sqlmock.NewResult(0, 0))

	mock.ExpectQuery("SELECT EXISTS").
		WithArgs("000001_test").
		WillReturnError(fmt.Errorf("check error"))

	testFS := fstest.MapFS{
		"000001_test.up.sql": &fstest.MapFile{
			Data: []byte("SELECT 1;"),
		},
	}

	_, err = runTyrMigrations(context.Background(), db, testFS)
	if err == nil {
		t.Fatal("expected error")
	}
}

func TestRunTyrMigrations_BeginTxError(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	mock.ExpectExec("CREATE TABLE IF NOT EXISTS tyr_schema_migrations").
		WillReturnResult(sqlmock.NewResult(0, 0))

	mock.ExpectQuery("SELECT EXISTS").
		WithArgs("000001_test").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))

	mock.ExpectBegin().WillReturnError(fmt.Errorf("begin error"))

	testFS := fstest.MapFS{
		"000001_test.up.sql": &fstest.MapFile{
			Data: []byte("SELECT 1;"),
		},
	}

	_, err = runTyrMigrations(context.Background(), db, testFS)
	if err == nil {
		t.Fatal("expected error")
	}
}

func TestRunTyrMigrations_RecordError(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	mock.ExpectExec("CREATE TABLE IF NOT EXISTS tyr_schema_migrations").
		WillReturnResult(sqlmock.NewResult(0, 0))

	mock.ExpectQuery("SELECT EXISTS").
		WithArgs("000001_test").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))

	mock.ExpectBegin()
	mock.ExpectExec("SELECT 1").WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectExec("INSERT INTO tyr_schema_migrations").
		WithArgs("000001_test").
		WillReturnError(fmt.Errorf("insert error"))
	mock.ExpectRollback()

	testFS := fstest.MapFS{
		"000001_test.up.sql": &fstest.MapFile{
			Data: []byte("SELECT 1;"),
		},
	}

	_, err = runTyrMigrations(context.Background(), db, testFS)
	if err == nil {
		t.Fatal("expected error")
	}
}
