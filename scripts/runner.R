# usage: Rscript runner.R OUTDIR
# Sources OUTDIR/script.R onto a PDF device (ggplot values print as at the
# console) and leaves OUTDIR/plot.pdf. Size: set `sciplot_size <- c(w, h)` (inches).
args <- commandArgs(trailingOnly = TRUE)
outdir <- args[1]
lib <- Sys.getenv("SCIPLOT_RLIB")
if (nzchar(lib)) .libPaths(c(lib, .libPaths()))
setwd(outdir)

code <- readLines("script.R", warn = FALSE)
size <- c(7, 4.5)
m <- regmatches(code, regexpr("sciplot_size\\s*<-\\s*c\\([^)]*\\)", code))
if (length(m)) size <- eval(parse(text = sub(".*<-", "", m[1])))

pdf("plot.pdf", width = size[1], height = size[2], useDingbats = FALSE)
ok <- tryCatch({
  source("script.R", local = new.env(), print.eval = TRUE, echo = FALSE)
  TRUE
}, error = function(e) {
  message("Error: ", conditionMessage(e))
  FALSE
})
invisible(dev.off())
if (!ok) quit(status = 1)
