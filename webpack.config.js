const path = require("path");

module.exports = {
    entry: "./src/index.ts",
    devtool: "inline-source-map",
    //default mode is production
    mode: "development",
    output: {
        path: path.resolve(__dirname, "dist"),
        filename: "index.js",
    },
    resolve: {
        extensions: [".ts", ".js", ".tsx"],
        fallback: { path: require.resolve("path-browserify"), fs: false },
    },
    devServer: {
        static: {
            directory: path.join(__dirname, "public"),
        },
        // compress: true,
        // port: 9000,
    },
    module: {
        rules: [
            {
                test: /\.js$/,
                exclude: /(node_modules)/,
                use: {
                    loader: "babel-loader",
                    options: {
                        presets: ["@babel/preset-env"],
                    },
                },
            },
            {
                test: /\.tsx?$/,
                use: "ts-loader",
                exclude: /node_modules/,
            },
            {
                test: /\.(png|jpe?g|gif|svg)$/,
                use: [
                    {
                        loader: "file-loader",
                        options: {
                            outputPath: "dist/images",
                        },
                    },
                ],
            },
            {
                test: /\.html$/,
                use: ["html-loader"],
            },
        ],
    },
};
