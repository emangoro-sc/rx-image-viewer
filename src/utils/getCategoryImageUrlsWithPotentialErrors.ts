import { defer, Observable } from "rxjs";

/** Utility to fire a request to a "server" to get the list of image urls in the current category */
function getCategoryImageUrlsWithPotentialErrors(categoryName: string): Observable<string[]> {
    const categoryImagesRequestEndpoint = `/categories/${categoryName}.json`;

    // defer ensure new Observable (and therefore) promise gets created for each subscription
    // rather than sharing the same promise between subscriptions. This ensures functions like retry will issue additional requests.
    return defer(() =>
        new Observable<string[]>((subscriber) => {
            // fails about 80% of times
            if (Math.random() < 0.8) {
                const artificialError = "Artificial getCategoryImageUrls server error"
                console.warn(artificialError)
                subscriber.error(artificialError);
            } else {
                fetch(categoryImagesRequestEndpoint, {
                    method: "GET",
                    headers: {
                        // "Content-Type": "application/json",
                    },
                })
                    .then((res) => res.json())
                    .then((data) => {
                        console.log({ categoryImageUrls: data });
                        const loadedImageUrls: string[] = data;
                        sessionStorage.setItem(categoryName, JSON.stringify(loadedImageUrls)); // local cache
                        console.log({ loadedImageUrls });
                        subscriber.next(loadedImageUrls);
                    })
                    .catch((errorReason) => {
                        subscriber.error(`getCategoryImageUrls error: ${errorReason}`);
                    });
            }
        }) 
    );
}

export default getCategoryImageUrlsWithPotentialErrors