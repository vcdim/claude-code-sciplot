function sciplot_runner(outdir, formats, latex)
% Run OUTDIR/script.m headless and export the current figure.
% FORMATS: comma list from png,pdf,svg,eps,jpg. Prints one SCIPLOT_RESULT JSON line.
set(groot, 'defaultFigureVisible', 'off');
set(groot, 'defaultAxesToolbarVisible', 'off');
if nargin > 2 && latex
    set(groot, 'defaultTextInterpreter', 'latex', ...
        'defaultAxesTickLabelInterpreter', 'latex', 'defaultLegendInterpreter', 'latex');
end
cd(outdir);
try
    run(fullfile(outdir, 'script.m'));
catch err
    fprintf(2, '%s\n', getReport(err, 'extended', 'hyperlinks', 'off'));
    exit(1);
end
if isempty(findobj(groot, 'Type', 'figure'))
    fprintf(2, 'No figure found: the script must draw something.\n');
    exit(1);
end
fig = gcf;
files = struct();
for fmt = strsplit(formats, ',')
    f = fmt{1};
    path = fullfile(outdir, ['plot.' f]);
    switch f
        case {'png', 'jpg'}
            exportgraphics(fig, path, 'Resolution', 150);
        case {'pdf', 'eps'}
            exportgraphics(fig, path, 'ContentType', 'vector');
        case 'svg'
            print(fig, path, '-dsvg');
        otherwise
            continue
    end
    files.(f) = path;
end
sz = [0 0];
if isfield(files, 'png')
    info = imfinfo(files.png);
    sz = [info.Width info.Height];
end
fprintf('SCIPLOT_RESULT %s\n', jsonencode(struct('kind', 'matlab', 'files', files, 'size', sz)));
end
