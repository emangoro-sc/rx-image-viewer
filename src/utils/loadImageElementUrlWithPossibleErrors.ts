import { Observable } from "rxjs";
import { IMAGE_LOADING_TIMEOUT_MS } from "..";

/** Util to create an image loading observable */
const loadImageElementUrlWithPossibleErrors = (imgElement: HTMLImageElement, url: string) => {
    return new Observable<string>((observer) => {
        if (Math.random() > 0.5) {
            const artificialError = "Artificial preload error";
            console.warn(artificialError);
            observer.error(artificialError);
        } else {
            imgElement.onerror = (event) => observer.error({ url, event });
            imgElement.onload = function () { 
                const artificialLoadingDurationMs = Math.random() * IMAGE_LOADING_TIMEOUT_MS * 4; // intentionally large so timeout functionality is used
                setTimeout(() => observer.next(url), artificialLoadingDurationMs);
                // ! dont call observer.complete() as this unsubscribes and removes image even if it was successful
            };

            // start image pre-loading
            imgElement.src = url;
        }

        const unsubscriber = () => {
            // removes listeners
            imgElement.onerror = null;
            imgElement.onload = null;
            // stops image loading in process
            imgElement.src = "";
        };
        return unsubscriber;
    });
};

export default loadImageElementUrlWithPossibleErrors