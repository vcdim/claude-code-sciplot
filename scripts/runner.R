# usage: Rscript runner.R OUTDIR
# Sources OUTDIR/script.R (ggplot values print as at the console) and leaves
# OUTDIR/plot.pdf. Size: `sciplot_size <- c(w, h)` in inches.
# SCIPLOT_LATEX=1 draws through tikzDevice + pdflatex (labels are LaTeX, e.g.
# "$\\sin(x)$"); on a LaTeX error it falls back to the plain pdf device.
args <- commandArgs(trailingOnly = TRUE)
outdir <- args[1]
lib <- Sys.getenv("SCIPLOT_RLIB")
if (nzchar(lib)) .libPaths(c(lib, .libPaths()))
setwd(outdir)

code <- readLines("script.R", warn = FALSE)
size <- c(7, 4.5)
m <- regmatches(code, regexpr("sciplot_size\\s*<-\\s*c\\([^)]*\\)", code))
if (length(m)) size <- eval(parse(text = sub(".*<-", "", m[1])))

draw <- function() {
  tryCatch({
    source("script.R", local = new.env(), print.eval = TRUE, echo = FALSE)
    TRUE
  }, error = function(e) {
    message("Error: ", conditionMessage(e))
    FALSE
  })
}

pdflatex <- Sys.getenv("SCIPLOT_PDFLATEX")
latex <- Sys.getenv("SCIPLOT_LATEX") == "1" && nzchar(pdflatex) &&
  requireNamespace("tikzDevice", quietly = TRUE)

if (latex) {
  options(tikzLatex = pdflatex, tikzDefaultEngine = "pdftex",
          tikzLatexPackages = c(getOption("tikzLatexPackages"), "\\usepackage{amsmath}\n"))
  tikzDevice::tikz("plot.tex", width = size[1], height = size[2], standAlone = TRUE)
  ok <- draw()
  invisible(dev.off())
  status <- if (!ok) 1 else system2(pdflatex, c("-interaction=nonstopmode", "-halt-on-error", "plot.tex"),
                    stdout = FALSE, stderr = FALSE)
  if (status == 0 && file.exists("plot.pdf")) quit(status = 0)
  message("sciplot: LaTeX failed on this figure, trying without LaTeX.")
  unlink(c("plot.pdf", "plot.tex"))
}

pdf("plot.pdf", width = size[1], height = size[2], useDingbats = FALSE)
ok <- draw()
invisible(dev.off())
if (!ok) quit(status = 1)
