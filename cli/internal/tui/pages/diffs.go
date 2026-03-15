package pages

import (
	"fmt"
	"image/color"
	"strings"

	tea "charm.land/bubbletea/v2"
	"charm.land/lipgloss/v2"
	"github.com/niuulabs/volundr/cli/internal/api"
	tui "github.com/niuulabs/volundr/cli/internal/tui"
)

// DiffFilesLoadedMsg carries the list of changed files from the session pod.
type DiffFilesLoadedMsg struct {
	Files []api.DiffFileEntry
	Err   error
}

// DiffContentLoadedMsg carries the diff content for a single file.
type DiffContentLoadedMsg struct {
	Path string
	Diff string
	Err  error
}

// DiffFile represents a file in the diff tree.
type DiffFile struct {
	Path      string
	Status    string // "M" modified, "A" added, "D" deleted
	Diff      string
	Additions int
	Deletions int
}

// DiffsPage displays a file tree and diff viewer.
type DiffsPage struct {
	files     []DiffFile
	filtered  []int // indices into files that match the search
	cursor    int
	scrollPos int
	search    string
	searching bool
	loading   bool
	loadErr   error
	width     int
	height    int

	// Session pod client for fetching diffs.
	podClient *api.SessionPodClient
	session   *api.Session
	client    *api.Client
}

// NewDiffsPage creates a new diffs page.
func NewDiffsPage(client *api.Client) DiffsPage {
	return DiffsPage{
		client: client,
	}
}

// Init initializes the diffs page.
func (d DiffsPage) Init() tea.Cmd { //nolint:gocritic // value receiver needed for page interface consistency
	return nil
}

// SetSession configures the diffs page for a specific session and loads files.
func (d *DiffsPage) SetSession(sess api.Session) tea.Cmd { //nolint:gocritic // hugeParam acceptable for API type
	d.session = &sess
	d.files = nil
	d.cursor = 0
	d.scrollPos = 0
	d.loading = true
	d.loadErr = nil

	if sess.CodeEndpoint == "" {
		d.loading = false
		d.loadErr = fmt.Errorf("session has no code endpoint (status: %s)", sess.Status)
		return nil
	}

	token := ""
	if d.client != nil {
		token = d.client.Token()
	}
	d.podClient = api.NewSessionPodClient(sess.CodeEndpoint, token)
	client := d.podClient
	return func() tea.Msg {
		files, err := client.GetDiffFiles("last-commit")
		return DiffFilesLoadedMsg{Files: files, Err: err}
	}
}

// Update handles messages for the diffs page.
func (d DiffsPage) Update(msg tea.Msg) (DiffsPage, tea.Cmd) { //nolint:gocritic // value receiver needed for page interface consistency
	switch msg := msg.(type) {
	case DiffFilesLoadedMsg:
		d.loading = false
		if msg.Err != nil {
			d.loadErr = msg.Err
			return d, nil
		}
		d.files = nil
		for _, f := range msg.Files {
			d.files = append(d.files, DiffFile{
				Path:      f.Path,
				Status:    f.Status,
				Additions: f.Additions,
				Deletions: f.Deletions,
			})
		}
		d.applySearch()
		// Load diff content for the first file.
		if len(d.filteredFiles()) > 0 {
			return d, d.loadDiffContent(d.actualIndex(0))
		}
		return d, nil

	case DiffContentLoadedMsg:
		if msg.Err == nil {
			for i := range d.files {
				if d.files[i].Path == msg.Path {
					d.files[i].Diff = msg.Diff
					break
				}
			}
		}
		return d, nil

	case tea.KeyMsg:
		if d.searching {
			return d.handleSearchInput(msg)
		}

		filtered := d.filteredFiles()
		switch msg.String() {
		case "up", "k":
			if d.cursor > 0 {
				d.cursor--
				d.scrollPos = 0
				return d, d.loadDiffContent(d.actualIndex(d.cursor))
			}
		case "down", "j":
			if d.cursor < len(filtered)-1 {
				d.cursor++
				d.scrollPos = 0
				return d, d.loadDiffContent(d.actualIndex(d.cursor))
			}
		case "G":
			if len(filtered) > 0 {
				d.cursor = len(filtered) - 1
				d.scrollPos = 0
				return d, d.loadDiffContent(d.actualIndex(d.cursor))
			}
		case "g":
			if len(filtered) > 0 {
				d.cursor = 0
				d.scrollPos = 0
				return d, d.loadDiffContent(d.actualIndex(d.cursor))
			}
		case "J":
			d.scrollPos++
		case "K":
			if d.scrollPos > 0 {
				d.scrollPos--
			}
		case "/":
			d.searching = true
			d.search = ""
		case "r":
			if d.session != nil {
				cmd := d.SetSession(*d.session)
				return d, cmd
			}
		}
	}
	return d, nil
}

// loadDiffContent fetches the diff content for a file if not already loaded.
func (d DiffsPage) loadDiffContent(index int) tea.Cmd { //nolint:gocritic // value receiver needed for page interface consistency
	if index < 0 || index >= len(d.files) || d.podClient == nil {
		return nil
	}
	file := d.files[index]
	if file.Diff != "" {
		return nil // Already loaded.
	}
	client := d.podClient
	path := file.Path
	return func() tea.Msg {
		diff, err := client.GetFileDiff("last-commit", path)
		return DiffContentLoadedMsg{Path: path, Diff: diff, Err: err}
	}
}

// SetSize updates the page dimensions.
func (d *DiffsPage) SetSize(w, h int) {
	d.width = w
	d.height = h
}

// View renders the diffs page.
func (d DiffsPage) View() string { //nolint:gocritic // value receiver needed for page interface consistency
	theme := tui.DefaultTheme

	titleStyle := lipgloss.NewStyle().
		Foreground(theme.TextPrimary).
		Bold(true).
		MarginBottom(1)

	// No session
	if d.session == nil {
		return lipgloss.NewStyle().
			Width(d.width).
			Height(d.height).
			Padding(1, 2).
			Render(lipgloss.JoinVertical(lipgloss.Left,
				titleStyle.Render("◧ Diffs"),
				"",
				lipgloss.NewStyle().Foreground(theme.AccentAmber).Render("  Select a session first (press 1 to go to Sessions, then Enter)"),
			))
	}

	// Loading
	if d.loading {
		return lipgloss.NewStyle().
			Width(d.width).
			Height(d.height).
			Padding(1, 2).
			Render(lipgloss.JoinVertical(lipgloss.Left,
				titleStyle.Render("◧ Diffs"),
				"",
				lipgloss.NewStyle().Foreground(theme.AccentAmber).Render("  Loading diffs..."),
			))
	}

	// Error
	if d.loadErr != nil {
		return lipgloss.NewStyle().
			Width(d.width).
			Height(d.height).
			Padding(1, 2).
			Render(lipgloss.JoinVertical(lipgloss.Left,
				titleStyle.Render("◧ Diffs"),
				"",
				lipgloss.NewStyle().Foreground(theme.AccentRed).Render(fmt.Sprintf("  Error: %v  (r to retry)", d.loadErr)),
			))
	}

	// Search bar
	var searchBar string
	if d.searching {
		searchBar = lipgloss.NewStyle().
			Foreground(theme.AccentAmber).
			Render("/ " + d.search + "\u2588")
	} else if d.search != "" {
		searchBar = lipgloss.NewStyle().
			Foreground(theme.TextMuted).
			Render("Filter: " + d.search + "  (/ to edit)")
	}

	// Split: file tree (left) and diff viewer (right)
	// Reserve space: title(1) + margin(1) + stats(1) + blank(1) + content + blank(1) + hints(1) + padding(2)
	treeWidth := 35
	diffWidth := d.width - treeWidth - 8
	paneHeight := d.height - 9
	if searchBar != "" {
		paneHeight--
	}

	tree := d.renderFileTree(treeWidth, paneHeight)
	diff := d.renderDiffView(diffWidth, paneHeight)
	content := lipgloss.JoinHorizontal(lipgloss.Top, tree, "  ", diff)

	// Stats summary
	totalAdd := 0
	totalDel := 0
	for _, f := range d.files {
		totalAdd += f.Additions
		totalDel += f.Deletions
	}

	stats := fmt.Sprintf("  %s  %s  %s files changed",
		lipgloss.NewStyle().Foreground(theme.AccentEmerald).Render(fmt.Sprintf("+%d", totalAdd)),
		lipgloss.NewStyle().Foreground(theme.AccentRed).Render(fmt.Sprintf("-%d", totalDel)),
		lipgloss.NewStyle().Foreground(theme.TextMuted).Render(fmt.Sprintf("%d", len(d.files))),
	)

	// Navigation hints
	hintStyle := lipgloss.NewStyle().Foreground(theme.TextMuted)
	hints := hintStyle.Render("  j/k select  G/g bottom/top  J/K scroll diff  / search  r refresh")

	// Scroll position indicator
	filtered := d.filteredFiles()
	var scrollInfo string
	if d.cursor >= 0 && d.cursor < len(filtered) {
		file := filtered[d.cursor]
		if file.Diff != "" {
			totalLines := len(strings.Split(file.Diff, "\n"))
			scrollInfo = hintStyle.Render(fmt.Sprintf("  line %d/%d", d.scrollPos+1, totalLines))
		}
	}

	parts := []string{
		titleStyle.Render("◧ Diffs"),
		stats,
	}
	if searchBar != "" {
		parts = append(parts, searchBar)
	}
	parts = append(parts, "", content, "", hints+scrollInfo)

	return lipgloss.NewStyle().
		Width(d.width).
		Height(d.height).
		Padding(1, 2).
		Render(lipgloss.JoinVertical(lipgloss.Left, parts...))
}

// renderFileTree renders the file tree sidebar.
func (d DiffsPage) renderFileTree(width, height int) string { //nolint:gocritic // value receiver needed for page interface consistency
	theme := tui.DefaultTheme
	filtered := d.filteredFiles()

	if len(filtered) == 0 {
		return lipgloss.NewStyle().
			Border(lipgloss.RoundedBorder()).
			BorderForeground(theme.BorderSubtle).
			Width(width).
			Height(height).
			Padding(1, 1).
			Foreground(theme.TextMuted).
			Render("  No changes")
	}

	var items []string
	for i, f := range filtered {
		var statusColor color.Color
		switch f.Status {
		case "M":
			statusColor = theme.AccentAmber
		case "A":
			statusColor = theme.AccentEmerald
		case "D":
			statusColor = theme.AccentRed
		}

		statusStyle := lipgloss.NewStyle().Foreground(statusColor)
		pathStyle := lipgloss.NewStyle().Foreground(theme.TextSecondary)

		statsStr := lipgloss.NewStyle().Foreground(theme.TextMuted).
			Render(fmt.Sprintf("+%d -%d", f.Additions, f.Deletions))

		line := fmt.Sprintf(" %s %s %s",
			statusStyle.Render(f.Status),
			pathStyle.Render(truncatePath(f.Path, width-14)),
			statsStr,
		)

		if i == d.cursor {
			items = append(items, lipgloss.NewStyle().
				Background(theme.BgTertiary).
				Foreground(theme.AccentAmber).
				Width(width-2).
				Render(line))
		} else {
			items = append(items, lipgloss.NewStyle().
				Width(width-2).
				Render(line))
		}
	}

	content := strings.Join(items, "\n")

	return lipgloss.NewStyle().
		Border(lipgloss.RoundedBorder()).
		BorderForeground(theme.BorderSubtle).
		Width(width).
		Height(height).
		Render(content)
}

// renderDiffView renders the diff content for the selected file.
func (d DiffsPage) renderDiffView(width, height int) string { //nolint:gocritic // value receiver needed for page interface consistency
	theme := tui.DefaultTheme
	filtered := d.filteredFiles()

	if len(filtered) == 0 {
		return lipgloss.NewStyle().
			Border(lipgloss.RoundedBorder()).
			BorderForeground(theme.BorderSubtle).
			Width(width).
			Height(height).
			Render(lipgloss.NewStyle().Foreground(theme.TextMuted).Render("  No file selected"))
	}

	file := filtered[d.cursor]

	if file.Diff == "" {
		return lipgloss.NewStyle().
			Border(lipgloss.RoundedBorder()).
			BorderForeground(theme.BorderSubtle).
			Width(width).
			Height(height).
			Padding(1, 1).
			Render(lipgloss.NewStyle().Foreground(theme.TextMuted).Render("  Loading diff..."))
	}

	lines := strings.Split(file.Diff, "\n")

	// Apply scroll offset
	if d.scrollPos >= len(lines) {
		d.scrollPos = max(0, len(lines)-1)
	}

	visibleLines := height - 2
	start := d.scrollPos
	end := start + visibleLines
	if end > len(lines) {
		end = len(lines)
	}

	var coloredLines []string
	for _, line := range lines[start:end] {
		switch {
		case strings.HasPrefix(line, "+"):
			coloredLines = append(coloredLines,
				lipgloss.NewStyle().Foreground(theme.AccentEmerald).Render(line))
		case strings.HasPrefix(line, "-"):
			coloredLines = append(coloredLines,
				lipgloss.NewStyle().Foreground(theme.AccentRed).Render(line))
		case strings.HasPrefix(line, "@@"):
			coloredLines = append(coloredLines,
				lipgloss.NewStyle().Foreground(theme.AccentCyan).Render(line))
		default:
			coloredLines = append(coloredLines,
				lipgloss.NewStyle().Foreground(theme.TextSecondary).Render(line))
		}
	}

	content := strings.Join(coloredLines, "\n")

	return lipgloss.NewStyle().
		Border(lipgloss.RoundedBorder()).
		BorderForeground(theme.BorderSubtle).
		Width(width).
		Height(height).
		Padding(0, 1).
		Render(content)
}

// handleSearchInput processes keystrokes in search mode.
func (d DiffsPage) handleSearchInput(msg tea.KeyMsg) (DiffsPage, tea.Cmd) { //nolint:gocritic // value receiver needed for page interface consistency
	switch msg.String() {
	case "enter", "esc":
		d.searching = false
	case "backspace":
		if d.search != "" {
			d.search = d.search[:len(d.search)-1]
		}
	case "space":
		d.search += " "
	default:
		if text := msg.Key().Text; text != "" {
			d.search += text
		}
	}
	d.applySearch()
	return d, nil
}

// Searching returns whether the search input is active.
func (d DiffsPage) Searching() bool { //nolint:gocritic // value receiver needed for page interface consistency
	return d.searching
}

// applySearch rebuilds the filtered index list based on the search term.
func (d *DiffsPage) applySearch() {
	d.filtered = nil
	lower := strings.ToLower(d.search)
	for i, f := range d.files {
		if d.search != "" && !strings.Contains(strings.ToLower(f.Path), lower) {
			continue
		}
		d.filtered = append(d.filtered, i)
	}
	if d.cursor >= len(d.filtered) {
		d.cursor = max(0, len(d.filtered)-1)
	}
}

// filteredFiles returns the DiffFile entries matching the current search.
func (d DiffsPage) filteredFiles() []DiffFile { //nolint:gocritic // value receiver needed for page interface consistency
	if len(d.filtered) == 0 && d.search == "" {
		return d.files
	}
	result := make([]DiffFile, 0, len(d.filtered))
	for _, idx := range d.filtered {
		if idx < len(d.files) {
			result = append(result, d.files[idx])
		}
	}
	return result
}

// actualIndex maps a filtered cursor position to the real files index.
func (d DiffsPage) actualIndex(cursor int) int { //nolint:gocritic // value receiver needed for page interface consistency
	if d.search == "" || len(d.filtered) == 0 {
		return cursor
	}
	if cursor < 0 || cursor >= len(d.filtered) {
		return cursor
	}
	return d.filtered[cursor]
}

// truncatePath shortens a file path to fit within the given width.
func truncatePath(path string, maxLen int) string {
	if len(path) <= maxLen {
		return path
	}
	return "..." + path[len(path)-maxLen+3:]
}
